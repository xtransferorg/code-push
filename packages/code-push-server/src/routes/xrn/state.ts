import { NativeAppVersionStatus } from '../../models/native_app_versions'

export class PublishStateMachine {
  private currentState: NativeAppVersionStatus
  private rolloutPercentage: number

  constructor(state: NativeAppVersionStatus, rolloutPercentage: number) {
    this.currentState = state
    this.rolloutPercentage = rolloutPercentage
  }

  public getCurrentState(): NativeAppVersionStatus {
    return this.currentState
  }

  public transitionTo(state: NativeAppVersionStatus, rollout: number): boolean {
    if (state === this.currentState) {
      return true
    }
    switch (this.currentState) {
      case NativeAppVersionStatus.ReadyForReview:
        if (
          state === NativeAppVersionStatus.PendingReview ||
          state === NativeAppVersionStatus.Rollout
        ) {
          this.currentState = state
          return true
        }
        break
      case NativeAppVersionStatus.PendingReview:
        if (state === NativeAppVersionStatus.Rollout) {
          this.currentState = state
          return true
        }
        break
      case NativeAppVersionStatus.Rollout:
        if (
          state === NativeAppVersionStatus.Published &&
          (this.rolloutPercentage >= 100 || rollout >= 100)
        ) {
          this.currentState = state
          return true
        } else if (state === NativeAppVersionStatus.Discarded) {
          this.currentState = state
          return true
        }
        break
      case NativeAppVersionStatus.Published:
        if (state === NativeAppVersionStatus.Discarded) {
          this.currentState = state
          return true
        }
        break
      case NativeAppVersionStatus.Discarded:
        // Discarded is a terminal state, no transitions allowed
        break
    }
    return false
  }
}
