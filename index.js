'use strict'

const request = require('request')
const url = require('url')
const AWS = require('aws-sdk')
const path = require('path')
const stream = require('stream')
const moment = require('moment')

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

// load dotenv file
require('dotenv').config({ path: path.resolve(__dirname, '.env') })

class Backup {
  constructor () {
    // configuration object
    this.config = {
      domain: process.env.CLUSTER_DOMAIN,
      auth: process.env.CONTROLLER_AUTH_KEY,
      s3: {
        access: process.env.S3_ACCESS_KEY,
        secret: process.env.S3_SECRET_KEY,
        bucket: process.env.S3_BUCKET
      }
    }
    // check required
    if (!this.config.auth) throw new Error('Controller auth key is missing')
    if (!this.config.domain) throw new Error('Cluster domain is missing')
    if (!this.config.s3.access) throw new Error('S3 access key is missing')
    if (!this.config.s3.secret) throw new Error('S3 secret key is missing')
    if (!this.config.s3.bucket) throw new Error('S3 bucket is missing')
    // initialize s3
    this.s3 = new AWS.S3({
      sslEnabled: true,
      accessKeyId: this.config.s3.access,
      secretAccessKey: this.config.s3.secret,
      signatureVersion: 'v4',
      params: {
        Bucket: this.config.s3.bucket
      }
    })
  }
  start () {
    let start = moment.utc()
    return new Promise((resolve, reject) => {
      let authStr = new Buffer(`:${this.config.auth}`).toString('base64')
      let req = request({
        url: url.format({
          protocol: 'https',
          hostname: 'controller.' + this.config.domain,
          pathname: '/backup'
        }),
        headers: {
          Authorization: `Basic ${authStr}`
        }
      })

      req.on('response', (res) => {
        // check status
        if (res.statusCode !== 200) {
          let err = new Error('Got a non 200 response')
          err.status = res.statusCode
          return reject(err)
        }
        // pipe response to file
        console.info('Processing backup file')
        res.pipe((() => {
          let pass = new stream.PassThrough()
          let timestamp = start.format('YYYY-MM-DD')
          let domain = this.config.domain.replace(/\./g, '-')
          this.s3.upload({
            Key: `flynn/daily/${domain}-${timestamp}.tar`,
            Body: pass,
            ACL: 'private'
          }, function (err, data) {
            // error handler
            if (err) {
              console.error(err)
              return reject(err)
            } else {
              console.info('Backup uploaded successfully')
              return resolve()
            }
          }).on('httpUploadProgress', (p) => {
            console.log('Loaded %sMB', (p.loaded / 1000000).toFixed(2))
          })
          return pass
        })())
      })
    })
  }
}

module.exports = Backup
