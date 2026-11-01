# Plan for lesson 0004

## Win
Predict what fx prints for a given input: run fx from the shell with fxctl and read its output.

## Fact
`fxctl run n` prints fx(n).

## Claims
- `fxctl run 7` prints 42.

## Probe
Run `fxctl run 7`; output 42 supports the claim.

## Step
Run `fxctl run 3` and see 18 printed.

## Elements
- held: fx and what it returns (lesson 0001).
- held: running a command in a shell (Floor, Known tools).
- new: one structure, the tool: `fxctl run` calls fx on its argument and prints the result.
