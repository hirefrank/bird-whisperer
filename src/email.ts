import { createTransport, type TransportOptions } from 'nodemailer';

export interface EmailClient {
  send(to: string, subject: string, body: string): Promise<void>;
}

export function createSmtpClient(
  host: string,
  port: number,
  user: string,
  password: string,
  from: string
): EmailClient {
  const transporter = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: password },
  } as TransportOptions);

  return {
    async send(to: string, subject: string, body: string): Promise<void> {
      await transporter.sendMail({
        from,
        to,
        subject,
        text: body,
        html: body.replace(/\n/g, '<br>'),
      });
    },
  };
}
