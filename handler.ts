import AWS from "aws-sdk";
import axios from 'axios';
const sslCertificate = require('get-ssl-certificate-tmp');

import Config from './config';

// In-memory cache to track sent notifications and prevent duplicates
const notificationCache = new Map<string, number>();
const NOTIFICATION_CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

// Helper function to send notifications with deduplication
async function sendNotification(webhookUrl: string, message: string, headers: any): Promise<void> {
  const now = Date.now();
  const cacheKey = message;
  
  // Check if this notification was sent recently
  const lastSent = notificationCache.get(cacheKey);
  if (lastSent && (now - lastSent) < NOTIFICATION_CACHE_TTL) {
    console.log(`Skipping duplicate notification: "${message}" (sent ${Math.round((now - lastSent) / 1000)}s ago)`);
    return;
  }
  
  // Send the notification
  try {
    await axios.post(webhookUrl, { "text": message }, { headers });
    notificationCache.set(cacheKey, now);
    console.log(`Notification sent: "${message}"`);
  } catch (error) {
    console.error(`Failed to send notification: "${message}"`, error);
  }
  
  // Clean up old entries from cache
  for (const [key, timestamp] of notificationCache.entries()) {
    if ((now - timestamp) >= NOTIFICATION_CACHE_TTL) {
      notificationCache.delete(key);
    }
  }
}

exports.run = async () => {
  const conf = Config();
  const headers = {
    'Content-Type': 'application/json'
  }
  const cert = await sslCertificate.get(conf.OIDC_LOGIN_DOMAIN, 5000, 443, "https:", true);
  let fingerprint = cert.issuerCertificate.fingerprint.toLowerCase().replace(/:/g, '');

  AWS.config.update({ region: conf.APP_AWS_REGION })
  const iam = new AWS.IAM()
  const options = {
    OpenIDConnectProviderArn: conf.APP_OIDC_IAM_ARN
  };
  iam.getOpenIDConnectProvider(options, (err, data) => {
    if (err) {
      console.log(conf.ERROR_MSG, err, err.stack);
      if (conf.SLACK_WEB_HOOK) {
        sendNotification(conf.SLACK_WEB_HOOK, conf.ERROR_MSG, headers);
      }
    }
    else {
      if (data.ThumbprintList.indexOf(fingerprint) === -1) {
        console.log(conf.STARTING_UPDATE_MSG);
        if (conf.SLACK_WEB_HOOK) {
          sendNotification(conf.SLACK_WEB_HOOK, conf.STARTING_UPDATE_MSG, headers);
        }
        data.ThumbprintList[0] = fingerprint;
        const updateParams = {
          OpenIDConnectProviderArn: conf.APP_OIDC_IAM_ARN,
          ThumbprintList: data.ThumbprintList
        };
        iam.updateOpenIDConnectProviderThumbprint(updateParams, function (err, data) {
          if (err) {
            console.log(conf.ERROR_MSG, err, err.stack);
            if (conf.SLACK_WEB_HOOK) {
              sendNotification(conf.SLACK_WEB_HOOK, conf.ERROR_MSG, headers);
            }
          } else {
            console.log(conf.UPDATE_COMPLETED_MSG, data);
            if (conf.SLACK_WEB_HOOK) {
              sendNotification(conf.SLACK_WEB_HOOK, conf.UPDATE_COMPLETED_MSG, headers);
            }
          }
        });
      }
    }
  });
};