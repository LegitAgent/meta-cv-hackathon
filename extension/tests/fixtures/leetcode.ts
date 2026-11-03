export function leetCodeDom(): { problem: string | null; lines: string[] } {
  return {
    problem: "Two Sum: Given an array of integers nums and an integer target...",
    lines: ["def twoSum(self, nums, target):", "    seen = {}", "    return []"],
  };
}

export function leetCodeNoEditor(): { problem: string | null; lines: string[] } {
  return { problem: "Two Sum: ...", lines: [] };
}
