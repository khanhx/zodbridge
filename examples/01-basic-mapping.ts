/**
 * Basic two-way mapping: DB entity (snake_case) <-> response DTO (camelCase).
 * Run: `npx tsx examples/01-basic-mapping.ts`
 */
import { z } from "zod";
import { createMap } from "zodbridge";

// The DTO schema is the source of truth for the output shape.
const UserDto = z.object({
  id: z.number(),
  fullName: z.string(),
  createdAt: z.string(),
});

const userMap = createMap(UserDto, {
  fullName: (row: { first_name: string; last_name: string }) =>
    `${row.first_name} ${row.last_name}`, // computed (one-way)
  createdAt: "created_at", // rename (auto-reversible)
});

const dbRow = { id: 1, first_name: "Ada", last_name: "Lovelace", created_at: "2024-01-01" };

const dto = userMap.forward(dbRow);
console.log("forward:", dto);
// { id: 1, fullName: "Ada Lovelace", createdAt: "2024-01-01" }

// `reverse` throws on a one-way computed rule (fullName). Use a reversible map:
const reversible = createMap(UserDto, {
  fullName: {
    to: (r: { first_name: string }) => r.first_name,
    from: (full: string) => full.split(" ")[0],
  },
  createdAt: "created_at",
});
console.log("reverse:", reversible.reverse({ id: 1, fullName: "Ada", createdAt: "2024-01-01" }));
// { fullName: "Ada", created_at: "2024-01-01" }
