// Copyright 2015 ISRG.  All rights reserved
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

'use strict';

var log      = require('npmlog');
var Promise  = require('bluebird');
var fs       = Promise.promisifyAll(require('fs'));

/**
 * Utilities
 */
class AcmeUtils {

  /**
   * Translate to Base64url
   *
   * @param  {String} x Base64
   * @return {String}   Base64url
   */
  static fromStandardB64(x) {
    return x.replace(/[+]/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Translate from Base64url
   * @param  {String} x Base64url
   * @return {String}   Base64
   */
  static toStandardB64(x) {
    var b64 = x.replace(/-/g, '+').replace(/_/g, '/').replace(/=/g, '');

    switch (b64.length % 4) {
      case 2: b64 += '=='; break;
      case 3: b64 += '=';  break;
      default:
    }

    return b64;
  }

  /**
   * Base64url encode a buffer
   * @param  {Buffer} buffer Encode these bytes
   * @return {String}        Base64url
   */
  static b64enc(buffer) {
    return this.fromStandardB64(buffer.toString('base64'));
  }

  /**
   * Base64url decode a string
   *
   * @param  {Base64} str Base64url
   * @return {Buffer}     Bytes decoded
   */
  static b64dec(str) {
    return new Buffer(str, 'base64');
  }

  /**
   * Is the string valid Base64url?
   * @param  {String} x Check this
   * @return {Boolean}  true if valid
   */
  static isB64String(x) {
    return (typeof(x) === 'string') && !x.match(/[^a-zA-Z0-9_-]/);
  }

  /**
   * Are the given fields set on the given object?
   * @param  {Array} fields Fields to check
   * @param  {Object} object check this
   * @return {Boolean}       Are all of the fields there?
   */
  static fieldsPresent(fields, object) {
    if (!Array.isArray(fields) || !object || (typeof(object) !== 'object')) {
      return false;
    }
    return fields.every(function(val) {
      return object.hasOwnProperty(val);
    });
  }

  /**
   * Is the given object a valid JSON Web Key (JWK)?
   *
   * @param  {Object} jwk The key to check
   * @return {Boolean}    true if valid
   */
  static validJWK(jwk) {
    if (!this.fieldsPresent(['kty'], jwk) || ('d' in jwk)) {
      return false;
    }
    switch (jwk.kty) {
      case 'RSA':
        return this.isB64String(jwk.n) && this.isB64String(jwk.e);
      case 'EC':
        return (typeof(jwk.crv) === 'string') &&
          this.isB64String(jwk.x) &&
          this.isB64String(jwk.y);
      default: return false;
    }
  }

  /**
   * Is the signature valid?
   *
   * @param  {Object} sig Object to check
   * @return {Boolean}    true if valid
   */
  static validSignature(sig) {
    if (!this.fieldsPresent(['alg', 'nonce', 'sig', 'jwk'], sig)) {
      return false;
    }
    return (typeof(sig.alg) === 'string') &&
      this.isB64String(sig.nonce) &&
      this.isB64String(sig.sig) &&
      this.validJWK(sig.jwk);
  }

  /**
   * A simple, non-standard fingerprint for a JWK,
   * just so that we don't have to store objects
   *
   * @param  {Object} jwk Key
   * @return {String}     [description]
   */
  static keyFingerprint(jwk) {
    if (!this.fieldsPresent(['kty'], jwk)) {
      throw new Error('Invalid key');
    }
    switch (jwk.kty) {
      case 'RSA': return '' + jwk.n;
      case 'EC':  return '' + jwk.crv + '|' + jwk.x + '|' + jwk.y;
      default: throw new Error('Unrecognized key type');
    }
  }

  /**
   * Copy all of the properties of the specified objects into a single,
   * new object.
   *
   * @param  {Object} objects The original objects
   * @return {Object}         The new object
   */
  static extend() {
    var o = {};
    // Note: nodejs does not support rest parameters (...) as of 5.3
    var objs = Array.prototype.slice.call(arguments, 0);
    objs.forEach(function(a) {
      if (a != null) {
        for (var i in a) {
          if (a.hasOwnProperty(i) && (a[i] != null)) {
            o[i] = a[i];
          }
        }
      }
    });

    return o;
  }

  /**
   * Extract the given fields, if they exist from the given object.
   *
   * @param  {Array} fields  The fields to extract, as an array of strings
   * @param  {Object} object The object from which to extract
   * @return {Object}        The extracted fields, as a new object
   */
  static extract(fields, object) {
    var ret = {};
    if (Array.isArray(fields) && object && (typeof(object) === 'object')) {
      fields.forEach(function(val) {
        if (object.hasOwnProperty(val)) {
          ret[val] = object[val];
        }
      });
    }
    return ret;
  }

  /**
   * Filter the given object, returning a new object whose contents pass
   * the filter function.
   *
   * @param  {object}   object The object to filter
   * @param  {Function} cb(key, value)  Return true to keep this key/value.
   * @return {[type]}                   The new object.
   */
  static filter(object, cb) {
    var ret = {};
    if (object && cb) {
      for (var i in object) {
        if (cb.call(object, i, object[i])) {
          ret[i] = object[i];
        }
      }
    }
    return ret;
  }

  /**
   * Read a JSON file.  Do not fail if the file cannot be read, doesn't exist,
   * has invalid JSON, etc.
   *
   * @param  {string=} filename The name of the file
   * @return {Promise<JSON>}    Fulfilled with the JSON, or null if the file
   *                            couldn't be read.
   */
  static readJSON(filename) {
    if (!filename) {
      return Promise.resolve(null);
    }
    return fs.readFileAsync(filename)
    .then(function(buf) {
      try {
        var json = JSON.parse(buf);
        return Promise.resolve(json);
      } catch (e) {
        log.warn(e.message, ' for ', filename);
        return Promise.resolve(null);
      }
    }, function(e) {
      log.warn(e.message, ' for ', filename);
      return Promise.resolve(null);
    });
  }

  /**
   * Write an object to a file, serialized as JSON.
   *
   * @param  {string} filename File to write to
   * @param  {object} obj      The object to write
   * @return {Promise<object>} Fulfilled when the file is written with `obj`.
   */
  static writeJSON(filename, obj) {
    var s = JSON.stringify(obj, null, 2);
    return fs.writeFileAsync(filename, s, 'utf-8')
    .return(obj);
  }
}

module.exports = AcmeUtils;
