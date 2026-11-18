#!/usr/bin/env bash
# One line per requirement of task 0001, in file order; it stops after the first failure.
if [ -f teach-0001/a.txt ]; then echo "ok a-exists"; else echo "FAIL a-exists: make the file a.txt inside teach-0001"; exit 1; fi
if [ -f teach-0001/b.txt ]; then echo "ok b-exists"; else echo "FAIL b-exists: make the file b.txt inside teach-0001"; exit 1; fi
if grep -q hello teach-0001/b.txt; then echo "ok b-text"; else echo "FAIL b-text: put the word hello in b.txt"; exit 1; fi
