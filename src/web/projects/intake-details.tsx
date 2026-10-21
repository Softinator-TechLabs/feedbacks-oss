import React from "react";
export function IntakeDetails({ context }: { context: unknown }) {
  if (
    !context ||
    typeof context !== "object" ||
    !("source" in context) ||
    context.source !== "public_intake"
  )
    return null;
  const intake = "intake" in context ? context.intake : undefined;
  if (!intake || typeof intake !== "object")
    return <p className="muted">Submitted through public website feedback.</p>;
  const contact =
    "contact" in intake && intake.contact && typeof intake.contact === "object"
      ? intake.contact
      : undefined;
  const email =
    contact && "email" in contact && typeof contact.email === "string"
      ? contact.email.slice(0, 254)
      : undefined;
  const element =
    "element" in intake && intake.element && typeof intake.element === "object"
      ? intake.element
      : undefined;
  const tag =
    element && "tag" in element && typeof element.tag === "string"
      ? element.tag.slice(0, 31)
      : undefined;
  return (
    <section className="section">
      <h3>Public website feedback</h3>
      <p>
        Anonymous visitor submission
        {tag ? ` about a selected ${tag} element` : " about this page"}. No screenshot or
        page text was captured.
      </p>
      {email && (
        <p>
          Visitor shared contact: <strong>{email}</strong>{" "}
          <span className="muted">
            (unverified). Sharing contact does not subscribe the visitor to email
            notifications.
          </span>
        </p>
      )}
    </section>
  );
}
