import { describe, expect, test } from "vitest"

import {
  CATEGORY_MIN_COSINE,
  CATEGORY_MIN_MARGIN,
  LOGIT_SCALE,
  pickCategory,
  scoreLabels,
} from "~background/functions/auto-tag"
import { SIGLIP_LOGIT_SCALE } from "../../../packages/backend/convex/lib/ai_config"

type Cat = Parameters<typeof pickCategory>[0][number]
const s = (key: Cat["key"], prob: number, cos: number): Cat => ({ key, prob, cos })

describe("SigLIP2 calibration", () => {
  test("softmax uses SigLIP's learned scale", () => {
    expect(LOGIT_SCALE).toBe(SIGLIP_LOGIT_SCALE)
    expect(LOGIT_SCALE).toBeGreaterThan(100)
    expect(LOGIT_SCALE).toBeLessThan(120)
  })

  test("a 0.02 cosine lead (typical SigLIP2 spread) gives a clear winner", () => {
    const unit = (i: number) => Array.from({ length: 3 }, (_, j) => (j === i ? 1 : 0))
    // image at cosine 0.14 to "hero" and 0.12 to "footer"
    const image = [0.14, 0.12, Math.sqrt(1 - 0.14 ** 2 - 0.12 ** 2)]
    const vectors = { "category:hero": unit(0), "category:footer": unit(1) }
    const scored = scoreLabels(
      image,
      [
        { key: "hero", prompts: [] },
        { key: "footer", prompts: [] },
      ],
      vectors,
      "category"
    )
    expect(scored[0]!.key).toBe("hero")
    expect(scored[0]!.prob - scored[1]!.prob).toBeGreaterThan(CATEGORY_MIN_MARGIN)
  })
})

describe("pickCategory", () => {
  test("clear, plausible winner", () => {
    expect(pickCategory([s("pricing", 0.7, 0.14), s("hero", 0.2, 0.12)])).toBe("pricing")
  })

  test("too close to the runner-up -> other", () => {
    expect(pickCategory([s("pricing", 0.45, 0.14), s("hero", 0.4, 0.139)])).toBe("other")
  })

  test("a softmax winner unlike every prompt -> other", () => {
    expect(pickCategory([s("photo", 0.9, CATEGORY_MIN_COSINE - 0.01), s("icon", 0.05, 0.02)])).toBe("other")
  })

  test("nothing scored -> other", () => {
    expect(pickCategory([])).toBe("other")
  })
})
