import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { defaultTagColor } from "../src/shared/taxonomy.js";

test("project taxonomy owns custom categories and reusable colored tags", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Website",
      origins: ["https://example.test"],
    });
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Other",
      origins: ["https://other.test"],
    });
    const initial = await ops.executeOperation(owner, "projects.taxonomy.get", {
      projectId: project.id,
    });
    assert.deepEqual(
      initial.categories.map((category: { id: string }) => category.id),
      ["general", "visualDesign", "productWorkflow", "usabilityAccessibility"],
    );
    assert.deepEqual(initial.tags, []);

    const created = await ops.executeOperation(owner, "projects.taxonomy.update", {
      projectId: project.id,
      revision: initial.revision,
      categories: [{ name: "Checkout", archived: false }],
      tags: [{ name: "mobile", color: "teal" }],
    });
    const custom = created.categories.at(-1);
    assert.match(custom.id, /^custom:/);
    assert.equal(custom.name, "Checkout");
    assert.equal(created.project.revision, created.revision);
    assert.deepEqual(created.tags, [{ name: "mobile", color: "teal", managed: true }]);
    const listedProject = (
      await ops.executeOperation(owner, "projects.list", {})
    ).items.find((item: { id: string }) => item.id === project.id);
    assert.equal(listedProject.taxonomy.categories[0].name, "Checkout");
    const invitation = await ops.executeOperation(owner, "members.invite", {
      email: "viewer@example.test",
      projectId: project.id,
      role: "viewer",
    });
    await ops.auth.acceptInvite(invitation.token, "Viewer", "Correct-Horse-Battery-123");
    const viewer = (
      await ops.auth.login("viewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    assert.equal(
      (
        await ops.executeOperation(viewer, "projects.taxonomy.get", {
          projectId: project.id,
        })
      ).categories.at(-1).name,
      "Checkout",
    );
    await assert.rejects(
      ops.executeOperation(viewer, "projects.taxonomy.update", {
        projectId: project.id,
        revision: created.revision,
        categories: [],
        tags: [],
      }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "projects.taxonomy.update", {
        projectId: project.id,
        revision: created.revision,
        categories: [
          { id: custom.id, name: "Checkout", archived: false },
          { id: custom.id, name: "Checkout again", archived: false },
        ],
        tags: [{ name: "mobile", color: "teal" }],
      }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "projects.taxonomy.update", {
        projectId: project.id,
        revision: initial.revision,
        categories: [],
        tags: [],
      }),
      { code: "CONFLICT" },
    );

    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Checkout is clipped",
      category: custom.id,
      tags: ["mobile", "checkout"],
      context: {
        url: "https://example.test/checkout",
        viewport: { width: 390, height: 844 },
      },
      idempotencyKey: "custom-category-thread",
    });
    assert.equal(thread.category, custom.id);
    const withNewTag = await ops.executeOperation(owner, "projects.taxonomy.get", {
      projectId: project.id,
    });
    assert.deepEqual(
      withNewTag.tags.map((tag: { name: string }) => tag.name),
      ["checkout", "mobile"],
    );
    assert.equal(
      withNewTag.tags.find((tag: { name: string }) => tag.name === "mobile").color,
      "teal",
    );
    assert.equal(
      withNewTag.tags.find((tag: { name: string }) => tag.name === "checkout").color,
      defaultTagColor("checkout"),
    );
    assert.equal(
      withNewTag.tags.find((tag: { name: string }) => tag.name === "checkout").managed,
      false,
    );
    assert.equal(
      (
        await ops.executeOperation(owner, "threads.list", {
          projectId: project.id,
          category: custom.id,
        })
      ).total,
      1,
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.create", {
        projectId: other.id,
        body: "Wrong project category",
        category: custom.id,
        context: {
          url: "https://other.test/",
          viewport: { width: 900, height: 800 },
        },
        idempotencyKey: "cross-project-category",
      }),
      { code: "VALIDATION" },
    );

    for (let index = 0; index < 17; index++)
      await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: `More feedback ${index}`,
        tags: Array.from({ length: 12 }, (_, tag) => `scale${index}_${tag}`),
        context: {
          url: "https://example.test/checkout",
          viewport: { width: 390, height: 844 },
        },
        idempotencyKey: `tag-vocabulary-${index}`,
      });
    const largeVocabulary = await ops.executeOperation(owner, "projects.taxonomy.get", {
      projectId: project.id,
    });
    assert.ok(largeVocabulary.tags.length > 200);
    const updatedVocabulary = await ops.executeOperation(
      owner,
      "projects.taxonomy.update",
      {
        projectId: project.id,
        revision: largeVocabulary.revision,
        categories: [{ id: custom.id, name: "Checkout", archived: false }],
        tags: [{ name: "scale0_0", color: "blue" }],
      },
    );
    assert.equal(
      updatedVocabulary.tags.find((tag: { name: string }) => tag.name === "scale0_0")
        .color,
      "blue",
    );
    assert.equal(
      updatedVocabulary.tags.find((tag: { name: string }) => tag.name === "mobile").color,
      "teal",
    );

    const archived = await ops.executeOperation(owner, "projects.taxonomy.update", {
      projectId: project.id,
      revision: updatedVocabulary.revision,
      categories: [{ id: custom.id, name: "Checkout flow", archived: true }],
      tags: [
        { name: "checkout", color: "rose" },
        { name: "mobile", color: "teal" },
      ],
    });
    assert.equal(archived.categories.at(-1).name, "Checkout flow");
    assert.equal(archived.categories.at(-1).archived, true);
    assert.equal(
      (await ops.executeOperation(owner, "threads.get", { threadId: thread.id }))
        .category,
      custom.id,
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "New item with archived category",
        category: custom.id,
        context: {
          url: "https://example.test/",
          viewport: { width: 900, height: 800 },
        },
        idempotencyKey: "archived-category",
      }),
      { code: "VALIDATION" },
    );
    await ops.executeOperation(owner, "threads.organize", {
      threadId: thread.id,
      revision: thread.revision,
      category: custom.id,
      tags: ["mobile"],
    });
    const updatedProject = await ops.executeOperation(owner, "projects.update", {
      projectId: project.id,
      revision: archived.revision,
      name: "Website updated",
      origins: ["https://example.test"],
    });
    assert.equal(updatedProject.name, "Website updated");
    assert.equal(
      (
        await ops.executeOperation(owner, "projects.taxonomy.get", {
          projectId: project.id,
        })
      ).categories.at(-1).name,
      "Checkout flow",
    );
  } finally {
    await pg.close();
  }
});
