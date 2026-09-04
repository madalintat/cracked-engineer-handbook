## Every technique for believing code is correct splits into which two halves?

- [x] Generating an input, and an oracle that recognises a wrong answer
- [ ] Writing the test, and running it in continuous integration
- [ ] Unit testing, and integration testing
- [ ] Finding the bug, and fixing it

@why Keeping them apart is what makes the rest of the subject bookkeeping. Most
confusion here comes from mixing them up.

## A fuzzing run finds nothing. What are the only two possibilities?

- [x] It cannot reach the code, or it cannot tell that the code is wrong
- [ ] The code is correct, or the fuzzer is misconfigured
- [ ] Not enough time, or not enough seeds
- [ ] The corpus is too small, or too large

@why Generation or oracle. Everything else is a special case of one of them.

## What does an example test check that a property test does not?

- [x] Nothing extra; it checks one point, where a property states a law over many
- [ ] The exact output value, which a property cannot express
- [ ] Performance, which properties ignore
- [ ] Compilation, which properties assume

@why The difference in what you write is small. The difference in what you get
is that the property forces you to write down the specification.

## Which property fully specifies a sort?

- [x] The result is ordered and is a permutation of the input
- [ ] The result is ordered
- [ ] The result has the same length as the input
- [ ] The first element is the smallest

@why Ordered alone is passed by an implementation that empties the list, and
that is what a suite of hand-picked expected outputs quietly permits.

## Why is a uniform generator over all 32 bit integers a poor one?

- [x] It essentially never produces 0, 1, -1, or either extreme, which are the values that have bugs
- [ ] It is slower than a biased generator
- [ ] It cannot produce negative numbers
- [ ] It repeats values too often

@why A good generator biases hard towards small magnitudes and known
boundaries. When you write your own, put the bias in on purpose.

## Your property needs valid inputs. What is wrong with generating randomly and discarding the invalid ones?

- [x] It collapses when few are accepted, and skews the distribution silently when merely some are
- [ ] It is correct but slow in every case
- [ ] The framework cannot express a precondition
- [ ] Discarded values still count towards the test count

@why The middle case is the dangerous one: enough get through to keep going,
and you test a narrow corner while believing you tested broadly.

## What is the better way to generate a valid structure with invariants?

- [x] Generate a sequence of operations and apply them, so everything is valid by construction
- [ ] Generate the structure and repair it afterwards
- [ ] Generate from a fixed list of known-good examples
- [ ] Increase the discard limit until enough get through

@why The distribution is then over states the program can actually reach, and
it tests the interface as well as the structure.

## What is shrinking for?

- [x] Reducing a failing input to a small one that still fails, so a person can read it
- [ ] Reducing the size of the test suite
- [ ] Reducing memory used by the generator
- [ ] Discarding failures that are not reproducible

@why A counterexample from the middle of a random space is technically a bug
report and practically useless. Shrinking is most of why the technique survives
contact with people.

## What did the 1990 random input study find?

- [x] Between a quarter and a third of standard system utilities crashed or hung on random input
- [ ] That random input rarely gets past input validation
- [ ] That most crashes were in one shared library
- [ ] That utilities were robust, and the bugs were in the shell

@why It also invented the field, and the origin was line noise on a dial up
connection during a thunderstorm.

## Why does purely random input stop at input validation?

- [x] It gets past a four byte magic number with a probability of one in four billion
- [ ] The operating system rejects malformed files before the program sees them
- [ ] Validation code is where most bugs are anyway
- [ ] Random bytes are rejected by the file system

@why That arithmetic is exactly why the second generation started from real
files and corrupted them instead.

## What did coverage guided fuzzing add?

- [x] One signal: did this input execute an edge no previous input executed
- [ ] A grammar describing the input format
- [ ] Symbolic execution of every branch
- [ ] A larger corpus of seed files

@why That single change converts a blind random walk into a hill climb over the
control flow graph, which is the entire reason modern fuzzing works.

## Why is the previous block's identifier shifted right by one before being stored?

- [x] So that A to B and B to A differ, and so a self loop does not index zero
- [ ] To fit two identifiers into one word
- [ ] To spread the hash more evenly across the map
- [ ] To leave the low bit free for a flag

@why Exclusive or is symmetric, so without the shift both directions of a loop
collide, and a block that jumps to itself gives zero for every block.

## Why are hit counts quantised into about eight classes?

- [x] Exact counts make every input look novel; a plain hit bit loses the difference between one iteration and two
- [ ] Eight classes fit in a byte, and nothing more is measurable
- [ ] The counters saturate at 255 anyway
- [ ] It makes the corpus deterministic across runs

@why It is a compromise, and it is what keeps the corpus bounded while
preserving loop depth sensitivity.

## Why is fuzzing C code without a sanitizer close to pointless?

- [x] A buffer overflow usually does not crash, so nothing screams and the fuzzer sees a successful run
- [ ] The fuzzer cannot instrument code that was not built with a sanitizer
- [ ] Sanitizers make the program faster to fuzz
- [ ] Without one, the corpus never grows

@why The coverage guided loop is the generator and the sanitizer is the oracle.
Neither is much use without the other.

## What can code coverage never tell you about?

- [x] Code that is not there: the missing bounds check, the unhandled error return
- [ ] Which lines your tests execute
- [ ] Which branches were taken only one way
- [ ] Which functions are never called

@why There is no line to leave uncovered, so the measurement is structurally
blind to omissions, and omissions are the category that produces security
advisories.
