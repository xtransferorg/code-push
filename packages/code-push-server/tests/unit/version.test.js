const { validatorVersion } = require('../../bin/core/utils/common')

describe('version', () => {
  it('validator version', () => {
    const [flag] = validatorVersion('1.0.*')
    flag.should.equal(true)
  })
})
