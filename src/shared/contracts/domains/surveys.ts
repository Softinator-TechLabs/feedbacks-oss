import { z } from "zod";
import { id, surveyQuestionsSchema } from "../common.js";

export const surveysInputs = {
  "surveys.create": z.object({
    projectId: id,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(""),
    questions: surveyQuestionsSchema,
    expiresInDays: z.number().int().min(1).max(90).default(30),
    maxResponses: z.number().int().min(1).max(1000).default(100),
  }),
  "surveys.list": z.object({ projectId: id }),
  "surveys.results": z.object({ surveyId: id }),
  "surveys.revoke": z.object({ surveyId: id }),
  "survey.inspect": z.object({ token: z.string().min(20).max(200) }),
  "survey.submit": z.object({
    token: z.string().min(20).max(200),
    answers: z.record(z.string(), z.union([z.string().max(500), z.number()])),
    responseKey: z.string().min(8).max(200),
    turnstileToken: z.string().min(1).max(2048),
  }),
};

export const surveysOutputs = {
  "surveys.create": z.object({
    id,
    token: z.string(),
    path: z.string(),
    expiresAt: z.string(),
  }),
  "surveys.list": z.object({
    items: z.array(
      z.object({
        id,
        title: z.string(),
        description: z.string(),
        questions: surveyQuestionsSchema,
        expiresAt: z.string(),
        revokedAt: z.string().nullable(),
        responses: z.number().int(),
        maxResponses: z.number().int(),
      }),
    ),
  }),
  "surveys.results": z.object({
    surveyId: id,
    total: z.number().int(),
    questions: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        prompt: z.string(),
        counts: z.record(z.string(), z.number().int()),
        nps: z.number().nullable(),
        answers: z.array(z.string()),
      }),
    ),
  }),
  "surveys.revoke": z.object({ revoked: z.boolean() }),
  "survey.inspect": z.object({
    projectName: z.string(),
    title: z.string(),
    description: z.string(),
    questions: surveyQuestionsSchema,
    expiresAt: z.string(),
    turnstileSiteKey: z.string(),
  }),
  "survey.submit": z.object({ posted: z.boolean() }),
};
