export class Pagination<T> {
  constructor(
    public list: T[],
    public current: number,
    public pageSize: number,
    public total: number,
  ) {}
}
