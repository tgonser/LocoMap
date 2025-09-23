import { MailService } from '@sendgrid/mail';

// Reference: SendGrid integration blueprint for JavaScript/TypeScript email sending

if (!process.env.SENDGRID_API_KEY) {
  console.warn("SENDGRID_API_KEY environment variable not set - email functionality disabled");
}

const mailService = new MailService();
if (process.env.SENDGRID_API_KEY) {
  mailService.setApiKey(process.env.SENDGRID_API_KEY);
}

interface EmailParams {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) {
    console.error('SendGrid API key not configured - cannot send email');
    return false;
  }

  try {
    await mailService.send({
      to: params.to,
      from: params.from,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    console.log(`Email sent successfully to ${params.to}`);
    return true;
  } catch (error) {
    console.error('SendGrid email error:', error);
    return false;
  }
}

// Helper function for contact form submissions
export async function sendContactFormEmail(name: string, email: string, message: string): Promise<boolean> {
  const emailParams: EmailParams = {
    to: 't@gonser.com',
    from: 't@gonser.com', // Use your own email as sender (must be verified in SendGrid)
    subject: `WhereWasI Contact Form: ${name}`,
    text: `
New contact form submission from your WhereWasI website:

Name: ${name}
Email: ${email}

Message:
${message}

---
You can reply directly to: ${email}
Sent from WhereWasI Contact Form
    `,
    html: `
<h2>New Contact Form Submission</h2>
<p><strong>Name:</strong> ${name}</p>
<p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
<br>
<p><strong>Message:</strong></p>
<p>${message.replace(/\n/g, '<br>')}</p>
<br>
<hr>
<p><em>You can reply directly to: <a href="mailto:${email}">${email}</a></em></p>
<p><em>Sent from WhereWasI Contact Form</em></p>
    `
  };

  return sendEmail(emailParams);
}