#!/usr/bin/env bash
# One line per requirement of task 0002, in file order; it stops after the first failure.
if [ -f teach-0002/c.txt ]; then echo "ok c-exists"; else echo "FAIL c-exists: make the file c.txt inside teach-0002"; exit 1; fi
if grep -q world teach-0002/c.txt; then echo "ok c-text"; else echo "FAIL c-text: put the word world in c.txt"; exit 1; fi
