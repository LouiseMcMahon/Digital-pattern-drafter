import type { FitTargets } from './fit';

/**
 * Reference measurement sets (cm) for acceptance tests (REQUIREMENTS.md R1/R2). The first users are
 * 6'2" (188 cm) women, so tall bodies in several builds are first-class fixtures.
 *
 * Each set was generated from a fitted body (fit the original 20 round numbers, read all measurements
 * off the result, round to 0.5 cm like a tape) so the set is self-consistent: armLength = upperArmLength +
 * forearmLength, crotchDepth = waistHeight - insideLeg, and so on. Inventing 34 numbers by hand produced
 * contradictory sets. These are NOT real people; replace with real sets when available.
 */
export const FIXTURES: Record<string, { label: string; preset: 'female' | 'male'; targets: FitTargets }> = {
  tall188Average: {
    label: "6'2\" woman, average build",
    preset: 'female',
    targets: { height: 188, neck: 35, shoulderWidth: 38, bust: 92, underbust: 78, waist: 75, highHip: 92, hip: 100, upperArm: 28, elbow: 26, wrist: 15.5, thigh: 58, knee: 38, calf: 37, ankle: 22, napeToWaist: 46, frontLength: 47, bustSeparation: 18, armLength: 64, insideLeg: 88, waistHeight: 115, armscyeDepth: 20.5, highBust: 91.5, acrossBack: 42, acrossChest: 32.5, shoulderLength: 12, shoulderToBust: 32, bustHeight: 137.5, waistToHip: 20, crotchDepth: 27, crotchLength: 61, upperArmLength: 36, forearmLength: 28, underarmLength: 52 },
  },
  tall188Broad: {
    label: "6'2\" woman, broad build",
    preset: 'female',
    targets: { height: 188, neck: 38, shoulderWidth: 41, bust: 112, underbust: 98, waist: 96, highHip: 108, hip: 120, upperArm: 36, elbow: 28, wrist: 17, thigh: 70, knee: 44, calf: 42, ankle: 25, napeToWaist: 47, frontLength: 50, bustSeparation: 21, armLength: 65, insideLeg: 86, waistHeight: 114, armscyeDepth: 21, highBust: 112.5, acrossBack: 44.5, acrossChest: 36, shoulderLength: 12.5, shoulderToBust: 34.5, bustHeight: 137, waistToHip: 21, crotchDepth: 28, crotchLength: 66, upperArmLength: 37, forearmLength: 28, underarmLength: 52 },
  },
  tall188Narrow: {
    label: "6'2\" woman, narrow build",
    preset: 'female',
    targets: { height: 188, neck: 32, shoulderWidth: 36, bust: 82, underbust: 70, waist: 64, highHip: 83, hip: 91, upperArm: 23, elbow: 25, wrist: 14, thigh: 50, knee: 33, calf: 33, ankle: 19, napeToWaist: 46, frontLength: 44, bustSeparation: 17, armLength: 66, insideLeg: 91, waistHeight: 117, armscyeDepth: 20, highBust: 81.5, acrossBack: 39, acrossChest: 31, shoulderLength: 11.5, shoulderToBust: 29.5, bustHeight: 140.5, waistToHip: 19.5, crotchDepth: 26, crotchLength: 57.5, upperArmLength: 36.5, forearmLength: 29.5, underarmLength: 55 },
  },
  petite155: {
    label: "5'1\" woman, petite",
    preset: 'female',
    targets: { height: 155, neck: 31, shoulderWidth: 34, bust: 84, underbust: 70, waist: 65, highHip: 84, hip: 92, upperArm: 24, elbow: 24.5, wrist: 14, thigh: 53, knee: 35, calf: 33, ankle: 20, napeToWaist: 37, frontLength: 38, bustSeparation: 16, armLength: 54, insideLeg: 70, waistHeight: 95, armscyeDepth: 19.5, highBust: 83, acrossBack: 37.5, acrossChest: 29, shoulderLength: 10.5, shoulderToBust: 28, bustHeight: 111.5, waistToHip: 18, crotchDepth: 25, crotchLength: 55.5, upperArmLength: 31, forearmLength: 23, underarmLength: 44 },
  },
  plus170: {
    label: "5'7\" woman, plus size",
    preset: 'female',
    targets: { height: 170, neck: 40, shoulderWidth: 41, bust: 125, underbust: 110, waist: 115, highHip: 122, hip: 135, upperArm: 38, elbow: 28.5, wrist: 18, thigh: 78, knee: 46, calf: 44, ankle: 25, napeToWaist: 42, frontLength: 48, bustSeparation: 22, armLength: 59, insideLeg: 77, waistHeight: 105, armscyeDepth: 21.5, highBust: 125.5, acrossBack: 44, acrossChest: 36, shoulderLength: 12.5, shoulderToBust: 37, bustHeight: 123, waistToHip: 20.5, crotchDepth: 28, crotchLength: 69, upperArmLength: 33.5, forearmLength: 25.5, underarmLength: 46 },
  },
};
