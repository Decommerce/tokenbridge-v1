import React from 'react'
import styled from 'styled-components'
import { InfoIcon } from './InfoIcon'
import { CloseIcon } from './CloseIcon'

const StyledErrorAlert = styled.div`
  border: 1px solid var(--warning-color);
  border-radius: 4px;
  margin-bottom: 20px;
  padding-top: 10px;
`

const CloseIconContainer = styled.div`
  cursor: pointer;
`

const TextContainer = styled.div`
  white-space: pre-wrap;
  flex-direction: column;
`

export const WarningAlert = ({ onClick, error }: { onClick: () => void; error: string }) => {
  return (
    <div className="row is-center">
      <StyledErrorAlert className="col-12 is-vertical-align row">
        <InfoIcon color="var(--warning-color)" />
        <TextContainer className="col-10">{error}</TextContainer>
        <CloseIconContainer className="col-1 is-vertical-align is-center" onClick={onClick}>
          <CloseIcon color="var(--warning-color)" />
        </CloseIconContainer>
      </StyledErrorAlert>
    </div>
  )
}
