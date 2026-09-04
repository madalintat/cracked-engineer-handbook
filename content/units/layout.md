---
needs: [cost-model]
minutes: 55
one_idea: The penalty for arranging data badly is exactly the fraction of each fetched cache line you actually use, so it does not exist while your record is smaller than a line and grows without limit once it is larger.
sources: [algorithms-on-real-hardware]
---

The previous unit established that the machine charges for memory movement
rather than for operations. This one is the direct consequence, and it is the
most actionable idea in this part: with the algorithm fixed, the operations
fixed and the complexity fixed, how the data is arranged decides how fast it
runs.

The rule is simple, and it is worth stating before the evidence. The penalty is
the ratio of what arrives to what you use. A cache line comes back
whole whatever fraction of it you asked for, so if a line holds one useful value
instead of sixteen, you have paid sixteen times over.

## Two arrangements

Records with several fields can be stored two ways.

An array of records puts each record's fields together and the records one after
another. A record of arrays puts each field in its own array, so all the first
fields are contiguous, then all the second fields, and so on.

For a loop that reads every field of one record at a time, the first is
obviously right. For a loop that reads one field of every record, which is what
most loops in a real program do, it is exactly wrong: every line fetched carries
one useful value and the rest of a record you did not ask about.

## The measurement, and the parameter that moves

Here is the same program, summing one four byte field over a few million
records, with only the record size changed. It was run on two machines whose
cache lines differ, which is what makes the table an experiment rather than an
anecdote.

```
   record size    128 byte lines     64 byte lines
   12 bytes          1.03x               1.01x
   32 bytes          0.97x               1.19x
   64 bytes          1.47x               3.66x
   128 bytes        20.81x               5.19x
```

Read it as three separate facts.

Below the line size there is no penalty at all. Both arrangements deliver
several records per line, so both are limited by bandwidth on data you were
going to fetch anyway.

At sixty four bytes the two machines disagree, and the disagreement is the
proof. On the machine with sixty four byte lines the record is exactly one line,
so each line yields one useful value out of sixteen, and the penalty is large. On
the machine with a hundred and twenty eight byte line the same record still
gives two useful values per line, and the penalty is small.

At a hundred and twenty eight bytes the machines swap places. Now the larger
line holds exactly one record, one useful value per line against thirty two the
other way, and the ratio is twenty times. The other machine has been in the
straddling regime since sixty four bytes and grows only gently.

Nothing in the source distinguished those runs. Nothing in the complexity did
either. The independent variable was a number in a struct definition, and the
dependent variable moved by a factor of twenty.

```figure
{
  "kind": "bits",
  "alt": "A sixty four byte cache line holding one whole record of which only a four byte field is read, against the same line holding sixteen consecutive values of that field.",
  "caption": "The same line, fetched at the same cost, delivering one useful value or sixteen. That ratio is the penalty, and it is why the effect switches on exactly when the record reaches the line size.",
  "bits": 64,
  "groups": [
    { "from": 0, "to": 3, "label": "used", "accent": "gold" },
    { "from": 4, "to": 63, "label": "fetched and discarded", "accent": "slate" }
  ],
  "brackets": [
    { "from": 0, "to": 63, "label": "one cache line", "lane": 0 }
  ]
}
```

## The bytes you did not ask for

Two more things move the same number, and both are free.

The first is padding. A field has to sit at an address that is a multiple of its
alignment, and the whole record has to be a multiple of its own alignment so
that an array of them works. The compiler inserts the gaps, and the order the
fields are declared in decides how many:

```
   struct { char a; long b; char c; };     24 bytes
   struct { long b; char a; char c; };     16 bytes
```

A third of the memory, recovered by moving one line. The rule is to declare
fields in decreasing order of size. C and C++ will never do it for you, because
the layout is the interface that separately compiled code agrees on; some other
languages do it for you unless you ask them not to, for exactly the same reason
in reverse.

Padding matters because it is transported. Every wasted byte occupies bandwidth,
cache capacity and address translation reach, and in the table above the record
size was the whole experiment.

The second is the opposite case, and it is worth holding beside the first so
neither is applied blindly. When two threads write to different variables that
happen to share a line, that line moves between the cores on every write, at the
cost of the coherence protocol, for no reason that exists in the program. The
fix there is to pad the variables apart until they are on different lines.

So: pack tightly for one thread walking a lot of data, and pad deliberately
apart for several threads writing nearby. They are the same fact about lines,
pointing in opposite directions.

## When the array of records is right

None of this makes one arrangement correct in general, and applying it as a
doctrine is how people end up with a slower program and more code.

The penalty is a property of the access pattern, not of the layout. A loop that
reads every field of a record, transforms it and writes it back is using the
whole line either way, and splitting the fields into separate arrays gives it
several streams to track instead of one, several address calculations instead
of one, and no benefit at all. The same is true of code that touches one record
at a time in an unpredictable order, where the record is the unit of work and
keeping its fields together is what you want.

So the question is not which layout is better. It is which fields are read
together, by the loop that runs most often, and the answer is a fact about the
program rather than a preference.

## Where this became an architecture

Game engines arrived at the same conclusion and built their state around it. The
approach stores the world as one array per component rather than one array of
objects: positions together, velocities together, health together, with an
entity being an index rather than a record.

Three arguments, and only the first is the one above.

A system touches few components. Physics reads position and velocity and writes
position. Walking an array of whole objects drags the mesh handle, the artificial
intelligence state and the inventory through the cache to get at twenty four
useful bytes of a record that is easily two hundred and fifty six. That is the
bottom row of the table, and worse.

Dispatch through a table of function pointers disappears. A loop over objects
calling a method on each is an indirect call per object, an unpredictable branch
per object, and a pointer chase per object. A loop over one component array with
one body is none of those, and it can be turned into vector instructions.

And storing entities with the same set of components together makes iteration
dense, so a system asking for everything with a position and a velocity walks
contiguous memory with no test per entity.

The slogan underneath all of it is worth keeping: the purpose of a program is to
transform data from one form into another, so the design should follow the
shape and the movement of the data rather than a taxonomy of nouns.

## What to carry forward

The penalty for a bad arrangement is the fraction of each fetched line you use.
It is zero while the record is smaller than a line, and it grows without limit
once the record is larger.

The same source measured 1.0 times, 3.66 times and 20.81 times on different
machines and record sizes, with no change to the algorithm, the operations or
the complexity.

Declaring fields in decreasing size order removes padding, and padding is
transported, so it costs bandwidth and cache capacity as well as memory.

Pack for a single thread walking data, and pad apart for several threads writing
nearby. Both follow from the line being the unit of transfer.

Next is the same argument for control flow rather than data: what a branch costs
when the machine cannot guess it, and why that changes which algorithm is
fastest.

## Reading the errors you are about to see

These compute the arrangement's cost directly: useful bytes per line, the
predicted ratio between two arrangements, the size of a record with its padding,
and the boundary at which two threads stop interfering.

`assert-failed` names the case your model got wrong. Several exercises assert
that a record smaller than a line has no penalty at all, which is the effect
switching on at the line size rather than a formula that forgot a case.
