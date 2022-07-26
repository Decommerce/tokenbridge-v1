require('../../env')
const url = require('url')
const dns = require('dns')
const connection = require('amqp-connection-manager').connect(process.env.ORACLE_QUEUE_URL)
const logger = require('./logger')
const { getRetrySequence } = require('../utils/utils')
const {
  SENDER_QUEUE_MAX_PRIORITY,
  SENDER_QUEUE_SEND_PRIORITY,
  SENDER_QUEUE_CHECK_STATUS_PRIORITY
} = require('../utils/constants')

connection.on('connect', () => {
  logger.info('Connected to amqp Broker')
})

connection.on('disconnect', () => {
  logger.error('Disconnected from amqp Broker')
})

async function isAttached() {
  if (!process.env.ORACLE_QUEUE_URL) {
    return false
  }
  const amqpHost = new url.URL(process.env.ORACLE_QUEUE_URL).hostname
  return new Promise(res => dns.lookup(amqpHost, err => res(err === null)))
}

function connectWatcherToQueue({ queueName, cb }) {
  const channelWrapper = connection.createChannel({
    json: true,
    async setup(channel) {
      await channel.assertQueue(queueName, { durable: true, maxPriority: SENDER_QUEUE_MAX_PRIORITY })
    }
  })

  const sendToQueue = data =>
    channelWrapper.sendToQueue(queueName, data, { persistent: true, priority: SENDER_QUEUE_SEND_PRIORITY })

  cb({ sendToQueue, channel: channelWrapper })
}

function connectSenderToQueue({ queueName, cb, resendInterval }) {
  const deadLetterExchange = `${queueName}-retry`

  const channelWrapper = connection.createChannel({
    json: true
  })

  channelWrapper.addSetup(async channel => {
    await channel.assertExchange(deadLetterExchange, 'fanout', { durable: true })
    await channel.assertQueue(queueName, { durable: true, maxPriority: SENDER_QUEUE_MAX_PRIORITY })
    await channel.bindQueue(queueName, deadLetterExchange)
    await channel.prefetch(1)
    await channel.consume(queueName, msg =>
      cb({
        msg,
        channel: channelWrapper,
        ackMsg: job => channelWrapper.ack(job),
        nackMsg: job => channelWrapper.nack(job, false, true),
        scheduleForRetry: async (data, msgRetries = 0) => {
          await generateRetry({
            data,
            msgRetries,
            channelWrapper,
            channel,
            queueName,
            deadLetterExchange
          })
        },
        scheduleTransactionResend: async data => {
          await generateTransactionResend({
            data,
            channelWrapper,
            channel,
            queueName,
            deadLetterExchange,
            delay: resendInterval
          })
        }
      })
    )
  })
}

async function generateRetry({ data, msgRetries, channelWrapper, channel, queueName, deadLetterExchange }) {
  const retries = msgRetries + 1
  const delay = getRetrySequence(retries) * 1000

  // New retry queue is created, and one message is send to it.
  // Nobody consumes messages from this queue, so eventually the message will be dropped.
  // `messageTtl` defines a timeout after which the message will be dropped out of the queue.
  // When message is dropped, it will be resend into the specified `deadLetterExchange` with the updated `x-retries` header.
  const retryQueue = `${queueName}-retry-${delay}`
  await channel.assertQueue(retryQueue, {
    durable: true,
    deadLetterExchange,
    messageTtl: delay,
    expires: delay * 10,
    maxPriority: SENDER_QUEUE_MAX_PRIORITY
  })
  await channelWrapper.sendToQueue(retryQueue, data, {
    persistent: true,
    priority: SENDER_QUEUE_SEND_PRIORITY,
    headers: { 'x-retries': retries }
  })
}

async function generateTransactionResend({ data, channelWrapper, channel, queueName, deadLetterExchange, delay }) {
  const retryQueue = `${queueName}-check-tx-status-${delay}`
  await channel.assertQueue(retryQueue, {
    durable: true,
    deadLetterExchange,
    messageTtl: delay,
    expires: delay * 10,
    maxPriority: SENDER_QUEUE_MAX_PRIORITY
  })
  await channelWrapper.sendToQueue(retryQueue, data, {
    priority: SENDER_QUEUE_CHECK_STATUS_PRIORITY,
    persistent: true
  })
}

module.exports = {
  isAttached,
  connectWatcherToQueue,
  connectSenderToQueue,
  connection,
  generateRetry
}
