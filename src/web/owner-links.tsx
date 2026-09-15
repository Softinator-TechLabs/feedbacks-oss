import React, { useState } from "react";
import { api, date, type Actor } from "./api.js";
import {
  useAction,
  useLoad,
  Secret,
  ActionState,
  ErrorNotice,
  Loading,
  ConfirmButton,
} from "./ui.js";
export function OwnerLinkSignIn({
  token,
  onAuthenticated,
}: {
  token: string;
  onAuthenticated: (actor: Actor) => void;
}) {
  const a = useAction();
  return (
    <main className="auth">
      <a className="brand" href="/">
        Feedbacks
      </a>
      <h1>Sign in with owner link</h1>
      <p>
        This link grants full browser access to its owner account. Continue only if this
        is your link. It can be used once and expires after seven days.
      </p>
      <button
        className="primary"
        disabled={a.busy || !token}
        onClick={() =>
          a.run(async () => {
            const r = await api<{ actor: Actor }>("auth.consumeLoginLink", {
              token,
            });
            history.replaceState(null, "", "/");
            onAuthenticated(r.actor);
          })
        }
      >
        Sign in as link owner
      </button>
      {!token && (
        <p role="alert">
          This link is missing its secret. Open the complete link supplied by its owner.
        </p>
      )}
      <ActionState action={a} />
    </main>
  );
}
export function OwnerLinks() {
  const a = useAction(),
    [version, setVersion] = useState(0),
    [link, setLink] = useState(""),
    { data, error } = useLoad(
      () =>
        api<{
          items: Array<{
            id: string;
            expiresAt: string;
            usedAt: string | null;
            revokedAt: string | null;
          }>;
        }>("account.links.list", {}),
      [version],
    );
  return (
    <section className="section">
      <h2>Owner sign-in links</h2>
      <p>
        A link grants full access to your own owner account, including its private
        information. Anyone holding it can sign in as you. Keep it private. This is not an
        agent token and does not authorize production changes.
      </p>
      <p>
        Links expire after seven days and work once. Revoking a used link also ends the
        browser session it created.
      </p>
      <form
        className="narrow"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            const r = await api("account.links.create", {});
            setLink(`${location.origin}${r.loginPath}`);
            setVersion((v) => v + 1);
          });
        }}
      >
        <button disabled={a.busy}>Create owner link</button>
      </form>
      {link && (
        <Secret
          value={link}
          label="Full owner access — copy only to a private location. This secret is shown once."
        />
      )}
      <ErrorNotice error={error} />
      {!data && !error ? (
        <Loading />
      ) : (
        data?.items.map((item) => (
          <div className="token-row" key={item.id}>
            <p>
              Expires {date(item.expiresAt)} ·{" "}
              {item.revokedAt ? "Revoked" : item.usedAt ? "Used" : "Unused"}
            </p>
            {!item.revokedAt && (
              <ConfirmButton
                disabled={a.busy}
                onConfirm={() =>
                  a.run(async () => {
                    await api("account.links.revoke", { linkId: item.id });
                    setLink("");
                    setVersion((v) => v + 1);
                  }, "Link and its linked session revoked.")
                }
              >
                Revoke link
              </ConfirmButton>
            )}
          </div>
        ))
      )}
      <ActionState action={a} />
    </section>
  );
}
