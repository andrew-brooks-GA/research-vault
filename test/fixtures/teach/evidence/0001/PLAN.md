# Plan for lesson 0001

## Win
Predict what fx prints for a given input.

## Fact
fx returns its input multiplied by six.

## Claims
- fx returns its input multiplied by six.
- Running fx with 7 prints 42.

## Probe
Run fx with 7; output 42 supports both claims.

## Step
Run fx with 3 and see 18 printed.

## Revisions
- Claim line "fx returns its input multiplied by six." was narrowed by the claims gate: the snippet shows the body and the probe covers only the input 7. Replacement claim: the body of fx is `return n * 6;`.
