/**
 * The README's demo has to keep telling the truth.
 */

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("npm run demo", () => {
    it("wakes the responder once, and only after maintenance ends", () => {
        const result = spawnSync(process.execPath, ["--import", "tsx", "../../demo/incident.mts"], {
            encoding: "utf8",
            timeout: 30000,
        });
        expect(result.status).toBe(0);
        expect(result.stdout.match(/>>> the responder wakes/g)).toHaveLength(1);
        expect(result.stdout.indexOf(">>>")).toBeGreaterThan(result.stdout.indexOf("Maintenance ends"));
    }, 40000);
});
