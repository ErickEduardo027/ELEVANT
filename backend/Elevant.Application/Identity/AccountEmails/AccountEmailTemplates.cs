using System.Net;
using System.Text;
using Elevant.Application.Abstractions.Messaging;

namespace Elevant.Application.Identity.AccountEmails;

/// <summary>Spanish ELEVANT emails for portal accounts, as HTML and plain text (ADR-0022).</summary>
public static class AccountEmailTemplates
{
    public static EmailMessage Activation(string to, string name, string airline, string link) => Build(to,
        "Activa tu cuenta del portal ELEVANT",
        $"Hola, {name}:",
        [$"AVIAM creó tu cuenta del portal de aerolíneas para {airline}.",
            "Confirma tu correo y crea tu contraseña con el botón. El enlace vence en 72 horas y sirve una sola vez."],
        ("Activar mi cuenta", link),
        "Si no esperabas este correo, ignóralo: nadie podrá entrar sin el enlace.");

    public static EmailMessage LoginCode(string to, string code) => Build(to,
        $"Tu código de acceso ELEVANT: {code}",
        "Código de inicio de sesión",
        ["Escribe este código en el portal para terminar de iniciar sesión. Vence en 10 minutos.", code],
        null,
        "Si no intentaste entrar, cambia tu contraseña: alguien la conoce.",
        highlightIndex: 1);

    public static EmailMessage PasswordReset(string to, string link) => Build(to,
        "Restablece tu contraseña del portal ELEVANT",
        "Restablecer contraseña",
        ["Recibimos una solicitud para cambiar la contraseña de tu cuenta del portal.",
            "El enlace vence en 30 minutos y sirve una sola vez."],
        ("Crear una contraseña nueva", link),
        "Si no lo pediste, ignora este correo: tu contraseña no cambia.");

    public static EmailMessage Test(string to) => Build(to,
        "Prueba de correo ELEVANT",
        "Prueba de envío",
        ["Este correo confirma que el servidor de ELEVANT puede enviar mensajes desde la cuenta no-reply."],
        null,
        "No hace falta responder.");

    private static EmailMessage Build(string to, string subject, string heading, string[] paragraphs,
        (string Label, string Url)? action, string footnote, int highlightIndex = -1)
    {
        var html = new StringBuilder();
        html.Append("<!doctype html><html lang=\"es\"><body style=\"margin:0;background:#f2f5f9;font-family:Segoe UI,Arial,sans-serif;color:#081b3a\">");
        html.Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"padding:32px 16px\">");
        html.Append("<table role=\"presentation\" width=\"560\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden\">");
        html.Append("<tr><td style=\"background:#081b3a;color:#ffffff;padding:20px 28px;font-weight:700;letter-spacing:.12em\">ELEVANT · AVIAM</td></tr>");
        html.Append("<tr><td style=\"padding:28px\">");
        html.Append($"<h1 style=\"margin:0 0 16px;font-size:20px\">{Encode(heading)}</h1>");
        for (var index = 0; index < paragraphs.Length; index++)
            html.Append(index == highlightIndex
                ? $"<p style=\"margin:16px 0;font-size:32px;font-weight:700;letter-spacing:.3em;text-align:center\">{Encode(paragraphs[index])}</p>"
                : $"<p style=\"margin:0 0 12px;line-height:1.5\">{Encode(paragraphs[index])}</p>");
        if (action is { } button)
        {
            html.Append($"<p style=\"margin:24px 0\"><a href=\"{Encode(button.Url)}\" style=\"background:#ff6b1a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700\">{Encode(button.Label)}</a></p>");
            html.Append($"<p style=\"margin:0 0 12px;font-size:12px;color:#4d5d76\">Si el botón no funciona, copia este enlace: {Encode(button.Url)}</p>");
        }
        html.Append($"<p style=\"margin:24px 0 0;font-size:12px;color:#4d5d76\">{Encode(footnote)}</p>");
        html.Append("</td></tr><tr><td style=\"padding:16px 28px;background:#f7f9fc;font-size:11px;color:#4d5d76\">Correo automático de ELEVANT. No respondas a este mensaje.</td></tr>");
        html.Append("</table></td></tr></table></body></html>");

        var text = new StringBuilder();
        text.AppendLine(heading).AppendLine();
        foreach (var paragraph in paragraphs) text.AppendLine(paragraph).AppendLine();
        if (action is { } link) text.AppendLine($"{link.Label}: {link.Url}").AppendLine();
        text.AppendLine(footnote).AppendLine().AppendLine("Correo automático de ELEVANT. No respondas a este mensaje.");
        return new EmailMessage(to, subject, html.ToString(), text.ToString());
    }

    private static string Encode(string value) => WebUtility.HtmlEncode(value);
}
