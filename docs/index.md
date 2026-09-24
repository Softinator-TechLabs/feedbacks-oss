# Documentation map

This is the entry point for contributors and coding agents. Guides describe current behavior; [decisions](decisions/0001-repository-harness.md) explain tradeoffs; [plans](plans/README.md) track substantial work. Start with the relevant row, then verify linked code and tests.

| Task                              | Read                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Understand the product            | [Purpose](why-feedbacks.md), [product brief](../PRODUCT.md), [review workflow](review-workflow.md)                                         |
| Use a team workspace              | [Start here](start-here.md), [extension](extension.md), [project routing](project-routing.md)                                              |
| Install and operate               | [Self-hosting](self-hosting.md), [operations and recovery](operations.md), [releases](releasing.md)                                        |
| Deliver thread activity           | [Signed webhooks](webhooks.md), [API](api.md)                                                                                              |
| Change code                       | [Agent entry point](../AGENTS.md), [contributing](../CONTRIBUTING.md), [development](development.md), [architecture](architecture.md)      |
| Run agent work                    | [Workflow](agent-workflow.md), [client adapters and skills](agent-tools.md), [verification](verification.md)                               |
| Connect an assistant to Feedbacks | [Assistant integration](agents.md), [key setup](agent-setup.md), [MCP contract](mcp-contract.md), [API](api.md)                            |
| Inspect operation capabilities    | [Generated operation catalog](generated/operations.md), [shared contracts](../src/shared/contracts.ts)                                     |
| Change UI or website              | [Design](../DESIGN.md), [website assets](website-assets.md), [source provenance](reference-provenance.md)                                  |
| Maintain knowledge                | [Docs instructions](maintaining-docs.md), [knowledge policy](knowledge.md), [quality gaps](quality.md), [plan template](plans/template.md) |
| Review dependencies or security   | [Dependencies](dependencies.md), [third-party notices](../THIRD_PARTY_NOTICES.md), [security reporting](../SECURITY.md)                    |
| Understand contribution policy    | [Governance](../GOVERNANCE.md), [conduct](../CODE_OF_CONDUCT.md), [trademarks](../TRADEMARKS.md)                                           |

Documentation checks enforce links and index reachability. They do not prove that every prose claim is current. Maintainers and agents must inspect the implementation when a relevant behavior changes.
