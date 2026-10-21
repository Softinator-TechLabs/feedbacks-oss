import nodemailer from "nodemailer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { MailIdentity, MailTransport } from "../../shared/notifications.js";

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  messageId: string;
};
export class MailSendError extends Error {
  constructor(
    public code: string,
    public disposition: "retry" | "failed" | "uncertain",
  ) {
    super(code);
  }
}
export async function sendMail(
  transport: MailTransport,
  identity: MailIdentity,
  mail: OutgoingMail,
) {
  if (transport.provider === "smtp") {
    const client = nodemailer.createTransport({
      host: transport.host,
      port: transport.port,
      secure: transport.port === 465,
      requireTLS: true,
      auth: transport.oauth
        ? { type: "OAuth2", user: transport.user, ...transport.oauth }
        : { user: transport.user, pass: transport.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      const result = await client.sendMail({
        from: { name: identity.fromName, address: identity.fromEmail },
        to: mail.to,
        replyTo: identity.replyTo,
        subject: mail.subject,
        text: mail.text,
        messageId: mail.messageId,
        envelope: { from: identity.fromEmail, to: [mail.to] },
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (!result.accepted?.length)
        throw new MailSendError("SMTP_RECIPIENT_REJECTED", "failed");
    } catch (error: any) {
      if (error instanceof MailSendError) throw error;
      const beforeData = [
        "CONN",
        "AUTH PLAIN",
        "AUTH LOGIN",
        "AUTH XOAUTH2",
        "MAIL FROM",
        "RCPT TO",
      ].includes(error.command);
      const rejected = typeof error.responseCode === "number";
      throw new MailSendError(
        error.code === "EAUTH" ? "SMTP_AUTH_FAILED" : "SMTP_SEND_FAILED",
        beforeData || rejected
          ? error.responseCode >= 500 || error.code === "EAUTH"
            ? "failed"
            : "retry"
          : "uncertain",
      );
    } finally {
      client.close();
    }
    return;
  }
  if (transport.provider === "mailjet") {
    let response: Response;
    try {
      response = await fetch("https://api.mailjet.com/v3.1/send", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Basic " +
            Buffer.from(`${transport.apiKey}:${transport.apiSecret}`).toString("base64"),
        },
        body: JSON.stringify({
          Messages: [
            {
              From: { Email: identity.fromEmail, Name: identity.fromName },
              To: [{ Email: mail.to }],
              ...(identity.replyTo ? { ReplyTo: { Email: identity.replyTo } } : {}),
              Subject: mail.subject,
              TextPart: mail.text,
              CustomID: mail.messageId,
            },
          ],
        }),
      });
    } catch {
      throw new MailSendError("MAILJET_RESPONSE_UNKNOWN", "uncertain");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new MailSendError(
        `MAILJET_HTTP_${response.status}`,
        response.status === 429
          ? "retry"
          : response.status >= 500
            ? "uncertain"
            : "failed",
      );
    }
    try {
      const data: any = await response.json();
      if (data.Messages?.length !== 1 || data.Messages[0].Status !== "success")
        throw new MailSendError("MAILJET_REJECTED", "failed");
    } catch (error) {
      if (error instanceof MailSendError) throw error;
      throw new MailSendError("MAILJET_RESPONSE_UNKNOWN", "uncertain");
    }
    return;
  }
  const client = new SESv2Client({
    region: transport.region,
    maxAttempts: 1,
    ...(transport.accessKeyId && transport.secretAccessKey
      ? {
          credentials: {
            accessKeyId: transport.accessKeyId,
            secretAccessKey: transport.secretAccessKey,
            sessionToken: transport.sessionToken,
          },
        }
      : {}),
  });
  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: `${identity.fromName.replace(/["<>]/g, "")} <${identity.fromEmail}>`,
        Destination: { ToAddresses: [mail.to] },
        ReplyToAddresses: identity.replyTo ? [identity.replyTo] : undefined,
        ConfigurationSetName: transport.configurationSet,
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: "UTF-8" },
            Body: { Text: { Data: mail.text, Charset: "UTF-8" } },
            Headers: [{ Name: "X-Feedbacks-Notification-ID", Value: mail.messageId }],
          },
        },
        EmailTags: [{ Name: "feedbacks", Value: "notification" }],
      }),
      { abortSignal: AbortSignal.timeout(20000) },
    );
  } catch (error: any) {
    const name = String(error.name);
    throw new MailSendError(
      "SES_SEND_FAILED",
      ["TooManyRequestsException", "ThrottlingException"].includes(name)
        ? "retry"
        : [
              "MessageRejected",
              "BadRequestException",
              "MailFromDomainNotVerifiedException",
              "NotFoundException",
              "AccountSuspendedException",
              "SendingPausedException",
              "AccessDeniedException",
              "CredentialsProviderError",
            ].includes(name)
          ? "failed"
          : "uncertain",
    );
  } finally {
    client.destroy();
  }
}
