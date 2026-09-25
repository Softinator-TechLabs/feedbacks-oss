import React, { useEffect, useState } from "react";
import type { z } from "zod";
import type { surveyQuestionsSchema } from "../shared/contracts.js";
import { api, date, type Project } from "./api.js";
import {
  ActionState,
  ConfirmButton,
  ErrorNotice,
  Field,
  Loading,
  Secret,
  useAction,
  useLoad,
} from "./ui.js";

type Question = {
  id: string;
  type: "nps" | "rating" | "single_choice" | "text";
  prompt: string;
  required: boolean;
  options?: string[];
};
type Survey = {
  id: string;
  title: string;
  description: string;
  questions: Question[];
  expiresAt: string;
  revokedAt: string | null;
  responses: number;
  maxResponses: number;
};
type Results = {
  surveyId?: string;
  total: number;
  questions: {
    id: string;
    type: string;
    prompt: string;
    counts: Record<string, number>;
    nps: number | null;
    answers: string[];
  }[];
};

export function Surveys({ project }: { project: Project }) {
  const [version, setVersion] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([
    {
      id: "q1",
      type: "nps",
      prompt: "How likely are you to recommend us?",
      required: true,
    },
  ]);
  const [link, setLink] = useState("");
  const [selected, setSelected] = useState<string>();
  const list = useLoad<{ items: Survey[] }>(
    () => api("surveys.list", { projectId: project.id }),
    [project.id, version],
  );
  const results = useLoad<Results>(
    () =>
      selected
        ? api("surveys.results", { surveyId: selected })
        : Promise.resolve({ total: 0, questions: [] }),
    [selected, version],
  );
  const action = useAction();
  const editQuestion = (id: string, patch: Partial<Question>) =>
    setQuestions((items) => items.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  return (
    <>
      <h1>Surveys</h1>
      <p className="muted">
        Ask visitors a short set of questions through a link you choose to share.
        Responses stay in this project.
      </p>
      {!project.permissions.canMaintain ? (
        <p>A project maintainer can create and review surveys.</p>
      ) : (
        <>
          <section className="section">
            <h2>Create a survey</h2>
            <p className="muted">
              Questions cannot be changed after the link is issued. Create another survey
              when you need a new version.
            </p>
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void action.run(async () => {
                  const created = await api<{ path: string }>("surveys.create", {
                    projectId: project.id,
                    title: String(data.get("title")),
                    description: String(data.get("description")),
                    questions: questions.map((question) =>
                      question.type === "single_choice"
                        ? {
                            ...question,
                            options: question.options
                              ?.map((option) => option.trim())
                              .filter(Boolean),
                          }
                        : question,
                    ) as z.input<typeof surveyQuestionsSchema>,
                    expiresInDays: Number(data.get("days")),
                    maxResponses: Number(data.get("maxResponses")),
                  });
                  setLink(`${location.origin}${created.path}`);
                  form.reset();
                  setQuestions([
                    {
                      id: "q1",
                      type: "nps",
                      prompt: "How likely are you to recommend us?",
                      required: true,
                    },
                  ]);
                  setVersion((value) => value + 1);
                }, "Survey created. Copy its link now.");
              }}
            >
              <Field label="Title">
                <input
                  name="title"
                  maxLength={120}
                  required
                  placeholder="Product pulse"
                />
              </Field>
              <Field
                label="Introduction"
                hint="Optional context visitors see before answering"
              >
                <textarea name="description" maxLength={1000} rows={2} />
              </Field>
              <div className="survey-questions">
                <h3>Questions</h3>
                {questions.map((question, index) => (
                  <fieldset key={question.id} className="survey-question">
                    <legend>Question {index + 1}</legend>
                    <Field label="Prompt">
                      <input
                        value={question.prompt}
                        maxLength={300}
                        required
                        onChange={(e) =>
                          editQuestion(question.id, { prompt: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Answer type">
                      <select
                        value={question.type}
                        onChange={(e) =>
                          editQuestion(question.id, {
                            type: e.target.value as Question["type"],
                            options:
                              e.target.value === "single_choice"
                                ? ["Option 1", "Option 2"]
                                : undefined,
                          })
                        }
                      >
                        <option value="nps">Recommendation · 0–10</option>
                        <option value="rating">Rating · 1–5</option>
                        <option value="single_choice">Single choice</option>
                        <option value="text">Written answer</option>
                      </select>
                    </Field>
                    {question.type === "single_choice" && (
                      <Field label="Choices" hint="One per line, 2–8 distinct choices">
                        <textarea
                          value={question.options?.join("\n") ?? ""}
                          rows={3}
                          onChange={(e) =>
                            editQuestion(question.id, {
                              options: e.target.value.split("\n"),
                            })
                          }
                        />
                      </Field>
                    )}
                    <label>
                      <input
                        type="checkbox"
                        checked={question.required}
                        onChange={(e) =>
                          editQuestion(question.id, { required: e.target.checked })
                        }
                      />{" "}
                      Required
                    </label>
                    {questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setQuestions((items) =>
                            items.filter((item) => item.id !== question.id),
                          )
                        }
                      >
                        Remove question
                      </button>
                    )}
                  </fieldset>
                ))}
                <button
                  type="button"
                  disabled={questions.length >= 8}
                  onClick={() =>
                    setQuestions((items) => [
                      ...items,
                      {
                        id: `q${Math.max(0, ...items.map((q) => Number(q.id.slice(1)) || 0)) + 1}`,
                        type: "text",
                        prompt: "",
                        required: false,
                      },
                    ])
                  }
                >
                  Add question
                </button>
              </div>
              <div className="survey-options">
                <Field label="Link expires after">
                  <select name="days" defaultValue="30">
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                  </select>
                </Field>
                <Field label="Maximum responses">
                  <input
                    name="maxResponses"
                    type="number"
                    min={1}
                    max={1000}
                    defaultValue={100}
                    required
                  />
                </Field>
              </div>
              <ActionState action={action} />
              <button className="primary" disabled={action.busy}>
                Create survey link
              </button>
            </form>
            {link && (
              <Secret
                value={link}
                label="Copy this survey link now. It is shown only once."
              />
            )}
          </section>
          <section className="section">
            <h2>Project surveys</h2>
            <ErrorNotice error={list.error} />
            {!list.data && !list.error && <Loading />}
            {list.data?.items.length === 0 && <p className="muted">No surveys yet.</p>}
            {list.data?.items.map((survey) => (
              <div className="survey-list-item" key={survey.id}>
                <div>
                  <strong>{survey.title}</strong>
                  <p className="muted">
                    {survey.revokedAt
                      ? "Revoked"
                      : new Date(survey.expiresAt).getTime() <= Date.now()
                        ? "Expired"
                        : survey.responses >= survey.maxResponses
                          ? "Full"
                          : `Expires ${date(survey.expiresAt)}`}{" "}
                    · {survey.responses} of {survey.maxResponses} responses
                  </p>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(survey.id === selected ? undefined : survey.id)
                    }
                    aria-expanded={selected === survey.id}
                  >
                    Results
                  </button>
                  {!survey.revokedAt && (
                    <ConfirmButton
                      disabled={action.busy}
                      onConfirm={() =>
                        void action.run(async () => {
                          await api("surveys.revoke", { surveyId: survey.id });
                          setVersion((value) => value + 1);
                        })
                      }
                    >
                      Revoke
                    </ConfirmButton>
                  )}
                </div>
                {selected === survey.id && (
                  <div className="survey-results">
                    <ErrorNotice error={results.error} />
                    {results.data?.surveyId !== selected && !results.error && <Loading />}
                    {results.data?.surveyId === selected && (
                      <>
                        <p>
                          <strong>{results.data.total}</strong> completed responses
                        </p>
                        {results.data.questions.map((q) => (
                          <div key={q.id}>
                            <h3>{q.prompt}</h3>
                            {q.type === "nps" && (
                              <p>
                                Net Promoter Score:{" "}
                                <strong>{q.nps === null ? "No answers" : q.nps}</strong>
                              </p>
                            )}
                            {q.type === "text" ? (
                              q.answers.length ? (
                                <ul>
                                  {q.answers.map((answer, i) => (
                                    <li key={i}>{answer}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="muted">No written answers.</p>
                              )
                            ) : Object.keys(q.counts).length ? (
                              <ul>
                                {Object.entries(q.counts)
                                  .sort(([a], [b]) =>
                                    a.localeCompare(b, undefined, { numeric: true }),
                                  )
                                  .map(([label, count]) => (
                                    <li key={label}>
                                      {label}: {count}
                                    </li>
                                  ))}
                              </ul>
                            ) : (
                              <p className="muted">No answers.</p>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}

export function SurveyPublic({ token }: { token: string }) {
  const [posted, setPosted] = useState(false);
  const [responseKey] = useState(() => crypto.randomUUID());
  const details = useLoad<{
    projectName: string;
    title: string;
    description: string;
    questions: Question[];
    expiresAt: string;
    turnstileSiteKey: string;
  }>(
    () =>
      token
        ? api("survey.inspect", { token })
        : Promise.reject(new Error("Open the complete survey link.")),
    [token],
  );
  const action = useAction();
  useEffect(() => {
    if (
      !details.data?.turnstileSiteKey ||
      document.querySelector('script[data-feedbacks-turnstile="true"]')
    )
      return;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.feedbacksTurnstile = "true";
    document.head.append(script);
  }, [details.data?.turnstileSiteKey]);
  return (
    <main className="guest-review" id="content">
      <a className="brand" href="/">
        Feedbacks
        <span className="brand-dot" />
      </a>
      <div className="guest-review-content">
        <ErrorNotice error={details.error} />
        {!details.data && !details.error && <Loading />}
        {details.data && (
          <>
            <h1>{details.data.title}</h1>
            <p className="muted">
              {details.data.projectName} · Expires {date(details.data.expiresAt)}
            </p>
            {details.data.description && <p>{details.data.description}</p>}
            {posted ? (
              <section className="section" role="status">
                <h2>Response sent</h2>
                <p>Thank you for sharing your feedback.</p>
              </section>
            ) : (
              <form
                className="section form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void (async () => {
                    const success = await action.run(async () => {
                      const answers: Record<string, string | number> = {};
                      for (const question of details.data!.questions) {
                        const raw = String(data.get(question.id) ?? "").trim();
                        if (raw)
                          answers[question.id] =
                            question.type === "rating" || question.type === "nps"
                              ? Number(raw)
                              : raw;
                      }
                      await api("survey.submit", {
                        token,
                        answers,
                        responseKey,
                        turnstileToken: String(data.get("cf-turnstile-response") ?? ""),
                      });
                      setPosted(true);
                    });
                    if (!success)
                      (
                        window as typeof window & { turnstile?: { reset: () => void } }
                      ).turnstile?.reset();
                  })();
                }}
              >
                {details.data.questions.map((question) => (
                  <Field
                    key={question.id}
                    label={question.prompt}
                    hint={question.required ? "Required" : "Optional"}
                  >
                    {question.type === "text" ? (
                      <textarea
                        name={question.id}
                        rows={4}
                        maxLength={500}
                        required={question.required}
                      />
                    ) : (
                      <select
                        name={question.id}
                        required={question.required}
                        defaultValue=""
                      >
                        <option value="">Choose an answer</option>
                        {question.type === "nps"
                          ? Array.from({ length: 11 }, (_, i) => (
                              <option key={i} value={i}>
                                {i}
                              </option>
                            ))
                          : question.type === "rating"
                            ? Array.from({ length: 5 }, (_, i) => (
                                <option key={i} value={i + 1}>
                                  {i + 1}
                                </option>
                              ))
                            : question.options?.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                      </select>
                    )}
                  </Field>
                ))}
                <p className="muted">
                  Your answers are visible to this project’s maintainers. This form does
                  not ask for your name or email.
                </p>
                <div
                  className="cf-turnstile"
                  data-sitekey={details.data.turnstileSiteKey}
                  data-action="survey_submit"
                  data-theme="auto"
                />
                <ActionState action={action} />
                <button className="primary" disabled={action.busy}>
                  Send response
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
