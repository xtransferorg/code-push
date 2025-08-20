export class Gray {
  constructor(
    public uniqueId: string,
    public rollout: number,
    public whiteList: string[],
  ) {}

  public isHitWhiteList() {
    return this.whiteList.find((item) => item === this.uniqueId)
  }

  public isHitRollout() {
    if (this.rollout >= 100) {
      return true
    }
    const numericValue = this.hexToDecimal()
    return numericValue < this.rollout
  }

  public isHit() {
    return this.isHitWhiteList() || this.isHitRollout()
  }

  private hexToDecimal() {
    const decimalValue = parseInt(this.uniqueId, 16)
    return Math.min(100, Math.max(0, Math.floor(decimalValue % 101)))
  }
}
