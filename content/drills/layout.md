## What sets the penalty for a bad data arrangement?

- [x] The fraction of each fetched cache line the loop actually uses
- [ ] The number of fields in the record
- [ ] Whether the data was allocated on the stack or the heap
- [ ] The total size of the data set

@why A line comes back whole whatever fraction you asked for, so a line holding
one useful value instead of sixteen was paid for sixteen times over.

## An array of records against an array per field: which suits a loop reading one field of every record?

- [x] An array per field, because every fetched line is then entirely that field
- [ ] An array of records, because the record is the unit of work
- [ ] Neither; the arrangement does not affect a linear scan
- [ ] It depends on the total number of records

@why That loop is what most loops in a real program do, and with records
interleaved every line carries one useful value and the rest of a record nobody
asked about.

## Below what size does the arrangement stop mattering?

- [x] The cache line size: below it, both arrangements deliver several records per line
- [ ] The page size
- [ ] The size of the first level cache
- [ ] The width of a vector register

@why It is why a twelve byte record measured no penalty at all on either
machine, and why the technique pays nothing when applied there.

## The same source measured 3.66 times on one machine and 1.47 on another, for the same record size. What differed?

- [x] The cache line size
- [ ] The clock speed
- [ ] The compiler version
- [ ] The number of cores

@why A sixty four byte record is exactly one line on one machine and half a
line on the other, which is what makes the table an experiment rather than an
anecdote.

## Why does a struct's field order change its size?

- [x] Each field must start at a multiple of its alignment, so padding is inserted, and the total is rounded up as well
- [ ] The compiler sorts fields by access frequency
- [ ] Later fields are stored in a separate section
- [ ] Only the first field's alignment matters

@why A char, a long and a char is twenty four bytes; the long first is sixteen.
A third of the memory recovered by moving one line.

## What is the rule for ordering fields?

- [x] Decreasing size, which leaves no internal gaps
- [ ] Increasing size, so small fields pack into the first line
- [ ] Alphabetical, for readability
- [ ] Most frequently accessed first

@why With the largest first every later field is already aligned, so the only
padding left is the rounding at the end.

## Why does C never reorder your fields for you?

- [x] The layout is the interface that separately compiled code agrees on
- [ ] It would break pointer arithmetic within the struct
- [ ] The standard requires alphabetical order
- [ ] Compilers cannot determine the best order

@why Some other languages do reorder unless you ask them not to, for exactly
the same reason stated in reverse.

## Why does padding cost more than the memory it wastes?

- [x] It is transported: it occupies bandwidth, cache capacity and address translation reach
- [ ] It slows down the alignment check at each access
- [ ] It prevents the compiler from vectorising
- [ ] It forces every field onto its own cache line

@why In the measurement, the record's size was the entire independent variable,
and padding is part of it.

## Two threads write to different variables on the same cache line. What happens?

- [x] The line moves between the cores on every write, at coherence protocol cost, for no reason in the program
- [ ] The writes are serialised by a lock the hardware inserts
- [ ] One write is lost unless the variables are atomic
- [ ] Nothing; the cores each cache their own copy

@why It is the same fact about lines as everything else in the unit, pointing
the other way.

## So what is the rule?

- [x] Pack for one thread walking a lot of data, and pad apart for several threads writing nearby
- [ ] Always pack as tightly as possible
- [ ] Always pad every variable to its own line
- [ ] Let the compiler decide, since it knows the access pattern

@why Both follow from the line being the unit of transfer, and applying either
one everywhere is how the technique starts costing more than it saves.

## When is an array of records the right choice?

- [x] When the hot loop reads most of the fields, or touches one record at a time in an unpredictable order
- [ ] Never; separate arrays are always faster
- [ ] When the record is smaller than a pointer
- [ ] When the data is read only

@why A loop using the whole record uses the whole line either way, and
splitting gives it several streams to track for nothing.

## What decides which layout to use?

- [x] Which fields are read together by the loop that runs most often
- [ ] The number of fields in the record
- [ ] Whether the language is object oriented
- [ ] The size of the data set relative to the cache

@why It is a fact about the program rather than a preference, which is why the
question is never which layout is better in general.

## Why does an entity component layout store one array per component?

- [x] A system reads few components, so an array of whole objects drags everything else through the cache
- [ ] Components are easier to serialise that way
- [ ] It reduces the number of allocations
- [ ] It allows components to be added at run time

@why Physics wants twenty four bytes of a record that is easily two hundred and
fifty six, which is the bottom row of the table and worse.

## What does a loop over an array of object pointers cost per element that a flat loop does not?

- [x] A pointer chase, a dispatch table load, and an unpredictable indirect call when the types differ
- [ ] Only the indirect call
- [ ] Only the pointer chase
- [ ] Nothing; the compiler devirtualises it

@why A flat loop over one component array with one body pays none of the three,
which is also why it can be turned into vector instructions.

## What is the underlying design principle?

- [x] The purpose of a program is to transform data from one form into another, so follow the data's shape and movement
- [ ] Model the problem domain as a taxonomy of types
- [ ] Optimise the innermost loop and leave the rest alone
- [ ] Prefer contiguous storage in all cases

@why The last one is a conclusion that happens to follow often, and stating it
as the principle is what turns the technique into a doctrine that misfires.
