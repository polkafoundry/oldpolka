const { types } = require('util')
const config = require('../../config')

exports.BaseSerializer = class BaseSerializer {
  serialize (o) {
    throw new Error('Not implemented.')
  }

  deserialize (o) {
    throw new Error('Not implemented.')
  }

  sanitize (o) {
    o = this.detect(o, new Set())
    try {
      // favor safety over performance
      // in the future, we should keep track of all changes
      // and do this only once at the end of the transaction
      this.deserialize(this.serialize(o))
    } catch (err) {
      throw new Error(`State object is not serializable: ${String(err)}`)
    }

    return o
  }

  getUnsupportedTypes () {
    return []
  }

  supportCircularRef () {
    return true
  }

  stripUndefined () {
    return (process.STATE_STRIP_UNDEFINED === '1') || config.state.stripUndefined || true
  }

  selfValidate (o) {
    const t = Object.prototype.toString.call(o).split(' ')[1].slice(0, -1)
    if (this.getUnsupportedTypes().includes(t) || types.isProxy(o)) {
      throw new Error(`State contains unsupported type: ${types.isProxy(o) ? 'Proxy' : t}`)
    }
  }

  detect (o, seenSet) {
    if (o == null) return null
    if (Buffer.isBuffer(o)) return o
    const t = typeof o

    this.selfValidate(o)

    const circularOk = this.supportCircularRef()

    const stripUndef = this.stripUndefined()
    if (stripUndef && t === undefined) {
      return null
    }

    if (t === 'object') {
      const propNames = Object.getOwnPropertyNames(o)
      for (const name of propNames) {
        const value = o[name]
        const vt = typeof value

        if (seenSet.has(value)) {
          if (circularOk || vt !== 'object') {
            continue
          } else {
            throw new Error(`State contains circular reference to ${value}`)
          }
        }
        seenSet.add(value)

        // these lines would 'sanitize' state, which might
        // throw error if object is frozen

        if (vt === 'undefined') {
          if (stripUndef) {
            if (Array.isArray(o)) {
              // should not delete if it is an array element, just turn it into null
              o[name] = null
            } else {
              delete o[name]
            }
          }
        } else {
          const sanitized = this.detect(value, seenSet)
          // avoid unnecessary reasignment which might raised error on frozen object
          if (sanitized !== o[name]) o[name] = sanitized
        }
      }
    }

    return o
  }
}

let instance
exports.getSerializer = name => {
  if (instance) return instance

  name = process.STATE_SERIALIZER || config.state.serializer || 'v8'
  instance = require(`./${name}`)
  return instance
}
