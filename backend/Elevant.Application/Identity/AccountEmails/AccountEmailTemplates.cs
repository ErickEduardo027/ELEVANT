using System.Globalization;
using System.Net;
using System.Text;
using Elevant.Application.Abstractions.Messaging;

namespace Elevant.Application.Identity.AccountEmails;

/// <summary>
/// Spanish ELEVANT emails for portal accounts, as HTML and plain text (ADR-0022). The HTML uses
/// the brand palette and the real logo as the inline image <see cref="LogoContentId"/>, which the
/// SMTP sender attaches; tables and inline styles keep it readable in Gmail and Outlook.
/// </summary>
public static class AccountEmailTemplates
{
    /// <summary>Content-ID of the inline ELEVANT logo the sender embeds.</summary>
    public const string LogoContentId = "elevant-logo";

    private const string Navy = "#04142e";
    private const string Ink = "#081b3a";
    private const string Orange = "#ff5c00";
    private const string Blue = "#1757d8";
    private const string Paper = "#f3f6fa";
    private const string Muted = "#56677c";

    public static EmailMessage Activation(string to, string name, string airline, string link) => Build(to,
        subject: "Activa tu cuenta del portal ELEVANT",
        preheader: $"AVIAM creó tu acceso al portal de aerolíneas para {airline}.",
        kicker: "Portal de aerolíneas",
        title: "Bienvenido a ELEVANT",
        greeting: $"Hola, {name}:",
        paragraphs: [$"AVIAM creó tu cuenta del portal de aerolíneas para {airline}. Desde ahí verás tus contratos, operaciones y facturación.",
            "Confirma tu correo y crea tu contraseña con el botón."],
        validity: "El enlace vence en 72 horas y sirve una sola vez",
        code: null,
        action: ("Activar mi cuenta", link),
        security: "Si no esperabas este correo, ignóralo: nadie podrá entrar sin este enlace.");

    public static EmailMessage LoginCode(string to, string code) => Build(to,
        subject: $"Tu código de acceso ELEVANT: {code}",
        preheader: $"Tu código es {code}. Vence en 10 minutos.",
        kicker: "Seguridad de tu cuenta",
        title: "Tu código de acceso",
        greeting: null,
        paragraphs: ["Escribe este código en el portal para terminar de iniciar sesión."],
        validity: "Vence en 10 minutos",
        code: code,
        action: null,
        security: "Si no intentaste entrar, cambia tu contraseña: alguien la conoce. Nunca compartas este código.");

    public static EmailMessage PasswordReset(string to, string link) => Build(to,
        subject: "Restablece tu contraseña del portal ELEVANT",
        preheader: "Crea una contraseña nueva para tu cuenta del portal.",
        kicker: "Seguridad de tu cuenta",
        title: "Restablece tu contraseña",
        greeting: null,
        paragraphs: ["Recibimos una solicitud para cambiar la contraseña de tu cuenta del portal de aerolíneas.",
            "Al guardarla se cerrarán todas las sesiones abiertas."],
        validity: "El enlace vence en 30 minutos y sirve una sola vez",
        code: null,
        action: ("Crear una contraseña nueva", link),
        security: "Si no lo pediste, ignora este correo: tu contraseña no cambia.");

    /// <summary>Both parties signed and the contract is active; the signed PDF travels attached (ADR-0025).</summary>
    public static EmailMessage ContractActivated(string to, string airline, string contractCode, DateOnly validFrom,
        DateOnly? validTo) => Build(to,
        subject: $"Contrato {contractCode} activo · ELEVANT",
        preheader: $"El contrato de {airline} con AVIAM ya está en vigor.",
        kicker: "Contratos",
        title: "Tu contrato está activo",
        greeting: null,
        paragraphs: [$"El contrato {contractCode} entre AVIAM y {airline} quedó firmado por ambas partes y está en vigor.",
            $"Vigencia: del {validFrom.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)} " +
            (validTo is { } end ? $"al {end.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}." : "sin fecha de fin."),
            "Adjuntamos el PDF firmado. También puedes consultarlo en el portal de aerolíneas."],
        validity: "Documento firmado por ambas partes",
        code: null,
        action: null,
        security: "Guarda este documento: su huella SHA-256 identifica el contenido que firmaron ambas partes.");

    /// <summary>The simulated e-CF invoice Finance issued, with its PDF attached (ADR-0035).</summary>
    public static EmailMessage InvoiceIssued(string to, string airline, string fiscalNumber, string currency, decimal total,
        decimal balance, DateOnly? dueDate) => Build(to,
        subject: $"Factura {fiscalNumber} de AVIAM · ELEVANT",
        preheader: $"AVIAM emitió la factura {fiscalNumber} a {airline}.",
        kicker: "Facturación",
        title: balance > 0 ? "Tienes una factura por pagar" : "Tu factura está saldada",
        greeting: null,
        paragraphs: [$"AVIAM emitió la factura {fiscalNumber} a {airline} por {currency} {total.ToString("N2", CultureInfo.InvariantCulture)}.",
            balance > 0
                ? $"Saldo pendiente: {currency} {balance.ToString("N2", CultureInfo.InvariantCulture)}" +
                  (dueDate is { } due ? $", con vencimiento el {due.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}." : ".") +
                  " Puedes pagarla con tarjeta en el portal de aerolíneas."
                : "El prepago confirmado cubrió el total: no tienes saldo pendiente.",
            "Adjuntamos el PDF. Es una simulación de e-CF sin validez fiscal."],
        validity: "Simulación — sin validez fiscal",
        code: null,
        action: null,
        security: "Si no reconoces esta factura, contacta a Finanzas de AVIAM antes de pagar.");

    public static EmailMessage Test(string to, DateTimeOffset? sentAt = null) => Build(to,
        subject: "Prueba de correo ELEVANT",
        preheader: "El remitente no-reply de ELEVANT funciona.",
        kicker: "Correo del sistema",
        title: "Prueba de envío correcta",
        greeting: null,
        paragraphs: ["Este correo confirma que el servidor de ELEVANT puede enviar mensajes desde la cuenta no-reply.",
            sentAt is { } at ? $"Solicitado el {at.ToUniversalTime().ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture)} UTC." : "No hace falta responder."],
        validity: "Remitente verificado",
        code: null,
        action: null,
        security: null);

    private static EmailMessage Build(string to, string subject, string preheader, string kicker, string title,
        string? greeting, string[] paragraphs, string validity, string? code, (string Label, string Url)? action,
        string? security)
    {
        var html = new StringBuilder();
        html.Append("<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">")
            .Append("<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
            .Append("<meta name=\"color-scheme\" content=\"light\"><meta name=\"supported-color-schemes\" content=\"light\">")
            .Append($"<title>{Encode(subject)}</title></head>")
            .Append($"<body style=\"margin:0;padding:0;background:{Paper};font-family:'Segoe UI',Roboto,Arial,sans-serif;color:{Ink}\">")
            // Inbox preview text, hidden in the message itself.
            .Append($"<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:{Paper}\">{Encode(preheader)}</div>")
            .Append($"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:{Paper}\"><tr><td align=\"center\" style=\"padding:28px 12px\">")
            .Append("<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(4,20,46,.08)\">");

        // Header: real logo and the brand stripe of the contract PDF.
        html.Append("<tr><td align=\"center\" style=\"padding:26px 24px 18px;background:#ffffff\">")
            .Append($"<img src=\"cid:{LogoContentId}\" width=\"150\" alt=\"ELEVANT\" style=\"display:block;width:150px;max-width:150px;height:auto;border:0\">")
            .Append("</td></tr>")
            .Append("<tr><td style=\"padding:0;font-size:0;line-height:0\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>")
            .Append($"<td width=\"34%\" style=\"height:5px;background:{Orange};font-size:0;line-height:0\">&nbsp;</td>")
            .Append($"<td style=\"height:5px;background:{Navy};font-size:0;line-height:0\">&nbsp;</td>")
            .Append("</tr></table></td></tr>");

        // Hero.
        html.Append($"<tr><td style=\"background:{Navy};padding:30px 36px 32px\">")
            .Append($"<p style=\"margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:{Orange}\">{Encode(kicker)}</p>")
            .Append($"<h1 style=\"margin:0;font-size:28px;line-height:1.2;font-weight:800;color:#ffffff\">{Encode(title)}</h1>")
            .Append("</td></tr>");

        // Body.
        html.Append("<tr><td style=\"padding:32px 36px 8px\">");
        if (greeting is not null)
            html.Append($"<p style=\"margin:0 0 14px;font-size:17px;font-weight:700;color:{Ink}\">{Encode(greeting)}</p>");
        foreach (var paragraph in paragraphs)
            html.Append($"<p style=\"margin:0 0 14px;font-size:15px;line-height:1.6;color:#2a3a52\">{Encode(paragraph)}</p>");

        if (code is not null)
        {
            html.Append("<table role=\"presentation\" align=\"center\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px auto 10px\"><tr>");
            foreach (var digit in code)
                html.Append($"<td style=\"padding:0 4px\"><div style=\"width:46px;height:58px;line-height:58px;text-align:center;font-family:'Consolas','Courier New',monospace;font-size:30px;font-weight:800;color:{Navy};background:#eef4ff;border:2px solid {Blue};border-radius:10px\">{Encode(digit.ToString())}</div></td>");
            html.Append("</tr></table>");
        }

        html.Append($"<p style=\"margin:16px 0 4px;text-align:{(code is null ? "left" : "center")}\"><span style=\"display:inline-block;padding:6px 12px;border-radius:999px;background:#fff1e9;color:#b54200;font-size:12px;font-weight:700\">&#9201; {Encode(validity)}</span></p>");

        if (action is { } button)
        {
            html.Append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px 0 8px\"><tr>")
                .Append($"<td align=\"center\" bgcolor=\"{Orange}\" style=\"border-radius:10px;background:{Orange}\">")
                .Append($"<a href=\"{Encode(button.Url)}\" style=\"display:inline-block;padding:15px 28px;font-size:16px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:10px\">{Encode(button.Label)} &rarr;</a>")
                .Append("</td></tr></table>")
                .Append($"<p style=\"margin:8px 0 0;font-size:12px;line-height:1.5;color:{Muted}\">¿El botón no funciona? Copia este enlace en el navegador:<br>")
                .Append($"<a href=\"{Encode(button.Url)}\" style=\"color:{Blue};word-break:break-all\">{Encode(button.Url)}</a></p>");
        }

        if (security is not null)
            html.Append($"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px 0 8px\"><tr><td style=\"padding:12px 16px;background:{Paper};border-left:4px solid {Orange};border-radius:6px;font-size:13px;line-height:1.5;color:#2a3a52\">&#128274; {Encode(security)}</td></tr></table>");
        html.Append("</td></tr>");

        // Footer.
        html.Append($"<tr><td style=\"padding:24px 36px 28px;background:{Navy};border-top:4px solid {Orange}\">")
            .Append("<p style=\"margin:0 0 6px;font-size:13px;font-weight:800;letter-spacing:.2em;color:#ffffff\">ELEV<span style=\"color:" + Orange + "\">A</span>NT</p>")
            .Append("<p style=\"margin:0 0 12px;font-size:12px;color:#aebbd0\">Elevando la gestión de operaciones en tierra.</p>")
            .Append("<p style=\"margin:0;font-size:11px;line-height:1.5;color:#7f90aa\">Correo automático de ELEVANT · AVIAM. No respondas a este mensaje.</p>")
            .Append("</td></tr>");

        html.Append("</table></td></tr></table></body></html>");

        var text = new StringBuilder();
        text.AppendLine($"ELEVANT · {kicker}").AppendLine().AppendLine(title).AppendLine();
        if (greeting is not null) text.AppendLine(greeting).AppendLine();
        foreach (var paragraph in paragraphs) text.AppendLine(paragraph).AppendLine();
        // The code stays alone on its own line so it can be copied (and found) easily.
        if (code is not null) text.AppendLine(code).AppendLine();
        text.AppendLine(validity + ".").AppendLine();
        if (action is { } link) text.AppendLine($"{link.Label}: {link.Url}").AppendLine();
        if (security is not null) text.AppendLine(security).AppendLine();
        text.AppendLine("Correo automático de ELEVANT · AVIAM. No respondas a este mensaje.");
        return new EmailMessage(to, subject, html.ToString(), text.ToString());
    }

    private static string Encode(string value) => WebUtility.HtmlEncode(value);
}
