import AWS from "aws-sdk";
import axios from 'axios';
const sslCertificate = require('get-ssl-certificate-tmp');

import Config from './config';

// Helper function to send notification and avoid duplicates
async function sendNotification(webhookUrl: string, message: string): Promise<void> {
  if (!webhookUrl) {
    return;
  }
  
  try {
    await axios.post(webhookUrl, { "text": message }, {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    // Log but don't throw - notification failure shouldn't break the main flow
    console.error('Failed to send notification:', error);
  }
}

exports.run = async () => {
  const conf = Config();
  
  try {
    // Get SSL certificate
    const cert = await sslCertificate.get(conf.OIDC_LOGIN_DOMAIN, 5000, 443, "https:", true);
    const fingerprint = cert.issuerCertificate.fingerprint.toLowerCase().replace(/:/g, '');

    // Configure AWS
    AWS.config.update({ region: conf.APP_AWS_REGION });
    const iam = new AWS.IAM();
    
    // Get current OIDC provider configuration
    const options = {
      OpenIDConnectProviderArn: conf.APP_OIDC_IAM_ARN
    };
    
    let data;
    try {
      data = await iam.getOpenIDConnectProvider(options).promise();
    } catch (err) {
      console.log(conf.ERROR_MSG, err, err.stack);
      await sendNotification(conf.SLACK_WEB_HOOK, conf.ERROR_MSG);
      return; // Early return prevents duplicate notifications
    }
    
    // Check if thumbprint update is needed
    if (data.ThumbprintList.indexOf(fingerprint) === -1) {
      console.log(conf.STARTING_UPDATE_MSG);
      await sendNotification(conf.SLACK_WEB_HOOK, conf.STARTING_UPDATE_MSG);
      
      // Update the thumbprint
      data.ThumbprintList[0] = fingerprint;
      const updateParams = {
        OpenIDConnectProviderArn: conf.APP_OIDC_IAM_ARN,
        ThumbprintList: data.ThumbprintList
      };
      
      try {
        const updateResult = await iam.updateOpenIDConnectProviderThumbprint(updateParams).promise();
        console.log(conf.UPDATE_COMPLETED_MSG, updateResult);
        await sendNotification(conf.SLACK_WEB_HOOK, conf.UPDATE_COMPLETED_MSG);
      } catch (err) {
        console.log(conf.ERROR_MSG, err, err.stack);
        await sendNotification(conf.SLACK_WEB_HOOK, conf.ERROR_MSG);
        return; // Early return prevents duplicate notifications
      }
    }
  } catch (error) {
    // Catch any unexpected errors at the top level
    console.error('Unexpected error in handler:', error);
    await sendNotification(conf.SLACK_WEB_HOOK, conf.ERROR_MSG);
    throw error; // Re-throw to mark Lambda execution as failed
  }
};