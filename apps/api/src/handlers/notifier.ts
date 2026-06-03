import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({});
const FROM = process.env.SES_FROM_EMAIL;

export async function sendClassificationNotification(
  toEmail: string,
  classification: 'offer' | 'interview_request',
  company: string,
  role: string,
): Promise<void> {
  if (!FROM) return;
  const subject =
    classification === 'offer'
      ? `Offer received from ${company}`
      : `Interview request from ${company}`;
  await ses.send(
    new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: `${role} at ${company}\n\nhttps://ghosted.macsampson.com` } },
      },
    }),
  );
}
