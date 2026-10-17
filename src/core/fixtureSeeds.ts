import type { FitTargets } from './fit';

/**
 * The round-number measurements each fixture starts from: 20 plain tape numbers per body, chosen to
 * describe a plausible person. `npm run fixtures:regenerate` fits a body to each seed set, reads every
 * measurement off that body (rounded to 0.5 cm) and writes src/core/fixtures.ts, so the fixtures are
 * self-consistent however the definitions change. Not real people.
 *
 * Seeds must describe a body the model can actually produce: an upper arm of 36-38 cm demanded of a body
 * whose elbow then reads 25 cm (ratio 0.66; the model's own bodies sit at 0.82-0.88) is a bad seed, not a
 * bad model, and a high bust above the bust is not a woman's body. fixtures.test.ts rejects both.
 */
export const FIXTURE_SEEDS: Record<string, { label: string; preset: 'female' | 'male'; seed: FitTargets }> = {
  tall188Average: {
    label: "6'2\" woman, average build",
    preset: 'female',
    seed: { height: 188, neck: 35, shoulderWidth: 38, bust: 92, underbust: 78, waist: 75, highHip: 92, hip: 100, upperArm: 28, wrist: 15.5, thigh: 58, knee: 38, calf: 37, ankle: 22, napeToWaist: 46, frontLength: 47, bustSeparation: 18, armLength: 64, insideLeg: 88, waistHeight: 115 },
  },
  tall188Broad: {
    label: "6'2\" woman, broad build",
    preset: 'female',
    seed: { height: 188, neck: 38, shoulderWidth: 41, bust: 112, underbust: 98, waist: 96, highHip: 108, hip: 120, upperArm: 33, elbow: 28, wrist: 17, thigh: 70, knee: 44, calf: 42, ankle: 25, napeToWaist: 47, frontLength: 50, bustSeparation: 21, armLength: 65, insideLeg: 86, waistHeight: 114 },
  },
  tall188Narrow: {
    label: "6'2\" woman, narrow build",
    preset: 'female',
    seed: { height: 188, neck: 32, shoulderWidth: 36, bust: 84, highBust: 82.5, underbust: 70, waist: 64, highHip: 83, hip: 91, upperArm: 23, wrist: 14, thigh: 50, knee: 33, calf: 33, ankle: 19, napeToWaist: 46, frontLength: 44, bustSeparation: 17, armLength: 66, insideLeg: 91, waistHeight: 117 },
  },
  petite155: {
    label: "5'1\" woman, petite",
    preset: 'female',
    seed: { height: 155, neck: 31, shoulderWidth: 34, bust: 84, underbust: 70, waist: 65, highHip: 84, hip: 92, upperArm: 24, wrist: 14, thigh: 53, knee: 35, calf: 33, ankle: 20, napeToWaist: 37, frontLength: 38, bustSeparation: 16, armLength: 54, insideLeg: 70, waistHeight: 95 },
  },
  plus170: {
    label: "5'7\" woman, plus size",
    preset: 'female',
    seed: { height: 170, neck: 40, shoulderWidth: 41, bust: 125, underbust: 110, waist: 115, highHip: 122, hip: 135, upperArm: 34, elbow: 29, wrist: 18, thigh: 78, knee: 46, calf: 44, ankle: 25, napeToWaist: 42, frontLength: 48, bustSeparation: 22, armLength: 59, insideLeg: 77, waistHeight: 105 },
  },
};
