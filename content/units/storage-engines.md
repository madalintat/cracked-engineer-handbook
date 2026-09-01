---
needs: [filesystems, flash]
minutes: 55
one_idea: B-tree or log-structured is not a taste question; the device's cost asymmetry picks it, and the choice is a trade between what reads cost and what writes cost.
sources: [compilers-interpreters-terminals-unix, cpu-architectures]
---

Every database has to solve one problem: keep an ordered collection on a device
that is slow, and answer point lookups, range scans and updates against it. There
are two families of answer, they have been competing for forty years, and the
thing that decides between them is not elegance.

## Three costs, and you cannot have all three

Any structure of this kind is a trade between three quantities, and improving one
worsens another.

Read amplification is how much you must read to answer a query. Write
amplification, which unit 039 already priced at the device level, is how much you
must write per byte of update. Space amplification is how much room the structure
takes beyond the data it holds.

A structure that keeps everything perfectly ordered has excellent reads and pays
for every update by rewriting the neighbourhood. A structure that appends
everything has excellent writes and pays on every read by looking in several
places. There is no arrangement with all three, and the choice is which one your
workload can afford to be bad at.

## Ordered in place

A B-tree keeps keys sorted in fixed-size pages, with interior pages of separators
pointing at children. A lookup walks from the root, one page per level, and the
tree is shallow: a fanout of a few hundred means a billion keys in four or five
levels.

Reads are close to optimal. A point lookup is a handful of page reads, and the
upper levels stay cached, so in practice it is one device access. A range scan
walks leaves in order, which is sequential.

The cost is in updates. Changing one record means reading its page, modifying it,
and writing the whole page back, so a hundred-byte update writes a page. At four
kilobytes that is amplification of forty before the device's own amplification is
applied on top, and unit 039 said what a small write does to a block-erased
medium.

And a page that fills has to split, which rewrites two pages and an ancestor, and
in the worst case propagates to the root.

```figure
{
  "kind": "blocks",
  "alt": "A B-tree with a root, interior separator pages and sorted leaves, beside a log-structured tree with a memory table and several sorted files of increasing size.",
  "caption": "Sorted in place against appended and merged later. The first is optimal to read and expensive to update; the second is the reverse, and the device decides which is the right mistake.",
  "boxes": [
    { "id": "r",  "x": 0,   "y": 0.2, "w": 3.2, "h": 1.1, "label": "root", "accent": "azure" },
    { "id": "i",  "x": 0,   "y": 1.6, "w": 3.2, "h": 1.1, "label": "separators", "accent": "azure" },
    { "id": "l",  "x": 0,   "y": 3.0, "w": 3.2, "h": 1.1, "label": "sorted leaves", "accent": "azure" },
    { "id": "m",  "x": 6.4, "y": 0.2, "w": 3.4, "h": 1.1, "label": "in memory", "accent": "gold" },
    { "id": "s1", "x": 6.4, "y": 1.6, "w": 3.4, "h": 1.1, "label": "small file", "accent": "jade" },
    { "id": "s2", "x": 6.4, "y": 3.0, "w": 3.4, "h": 1.1, "label": "larger file", "accent": "jade" }
  ],
  "arrows": [
    { "from": "r", "to": "i" },
    { "from": "i", "to": "l" },
    { "from": "m", "to": "s1" },
    { "from": "s1", "to": "s2" }
  ]
}
```

## Appended, and sorted out later

The other family never updates anything in place. Writes go into a sorted
structure in memory, and when it fills it is written out as one immutable sorted
file. Those files accumulate, and a background process merges them into fewer,
larger ones.

Writes are as cheap as they can be: an append to a log for durability and an
insertion into memory. Nothing is read to perform an update, and nothing on the
device is modified.

The cost lands on reads. A key may be in the memory table or in any of the files,
so a lookup that finds nothing has to check all of them. That is what the two
mitigations exist for: every file carries a summary structure that can say
definitely not present without a read, and a cache holds the ones consulted most.

And the merging is not free. It is the write amplification, deferred and batched:
each record is rewritten once per level it passes through, so a structure with
seven levels rewrites everything about seven times over its life. The difference
from the B-tree is that this happens in large sequential runs at a time of the
system's choosing rather than in small random writes at the time of the update.

## Which the device decides

Now the reason this is not a taste question.

On a spinning disk a random write and a random read cost about the same, both
dominated by the seek, so the B-tree's page rewrite is not obviously worse than
anything else. The structure was designed for that machine and it fits it.

On flash the costs are not symmetric. A read is tens of microseconds; a small
random write is cheap to issue and expensive downstream, because unit 039's
controller must eventually erase a block hundreds of times larger. Small random
writes are the one thing the medium is worst at.

So the log-structured design is not a general improvement. It is a response to a
device whose write path is the expensive one, converting many small random writes
into few large sequential ones, which is precisely the transformation that makes
the controller's garbage collection cheap.

Change the device again and the answer changes again. That is the whole argument.

## The summary that answers without reading

The structure that lets a log-structured engine skip files deserves its own
paragraph, because it is a good example of paying space for reads.

Each file carries a compact filter over the keys it contains. Asked whether a key
is present, it answers definitely not or possibly, never definitely yes. A
negative answer skips the file with no device access at all; a positive answer
means reading it and finding out.

The cost is a few bits per key held in memory and a false positive rate that
falls as you spend more. Ten bits per key gives roughly one percent, so a lookup
across seven files reads about one of them unnecessarily rather than all seven.

It is the third amplification being traded for the first: memory spent to avoid
reads. And it only helps for keys that are absent, which is why a workload of
lookups that mostly succeed gets far less from it than one checking for existence.

## What the workload decides

The device narrows it and the workload picks.

A read-heavy workload with occasional updates wants the B-tree: reads are
optimal, and the update cost is paid rarely. A write-heavy workload with
scattered keys wants the log structure, because the alternative is one page
rewrite per update and the device will hate it.

Range scans favour the B-tree, since leaves are already in order, where the log
structure must merge several files on the fly. Point lookups of keys that do not
exist favour the B-tree too, unless the summaries are doing their job.

And space is the third axis. The log structure holds superseded versions until a
merge removes them, so it can occupy substantially more than its live data,
while a B-tree's pages are typically most of the way full and its overhead is
bounded.

## Deleting something that was never there

One asymmetry the log structure has and the B-tree does not, because it catches
people.

Nothing is modified in place, so a deletion cannot remove anything. It writes a
marker saying this key is gone, and that marker has to persist until every older
file that might contain the key has been merged away. Until then a lookup finds
the marker first and reports absence correctly.

The consequence is that deleting does not free space and can consume it, and a
workload that inserts and deletes the same keys repeatedly accumulates markers
faster than merging removes them. A range that was emptied still has to be walked
past, so scanning a mostly deleted region reads all the markers.

There is no equivalent in a B-tree, where a delete removes the record from its
page and the space is immediately reusable. It is the clearest single example of
the family difference: in one structure a delete is an update, and in the other
it is another append.

## Where the durability goes

Both families need the same thing underneath, and it is the previous two units.

An update is written to a log and that log is flushed before the update is
acknowledged, because unit 041 said a write that returned is only a dirty page.
Recovery replays the log against whatever survived. That is the same protocol a
filesystem journal uses and for the same reason.

The cost is one flush per commit, which unit 041 also priced, so a system doing
many small durable updates is limited by flushes per second. Grouping several
commits into one flush is the standard answer, and it trades a little latency for
a great deal of throughput.

Which means the durability mechanism is the same whichever structure you chose.
The structure decides what the steady state costs; the log decides what a crash
costs.

## What to carry forward

Read, write and space amplification trade against each other and no structure is
good at all three.

A B-tree is ordered in place, optimal to read, and rewrites a page per update. A
log-structured tree appends and merges, is optimal to write, and pays on reads
that must consult several files.

The device picks the family, because flash is worst at small random writes and a
disk was not. The workload picks within it. And both sit on a flushed log,
because that is the only durability the layers below offer.

## Reading the errors you are about to see

These compute the amplification arithmetic, which is exact, where a benchmark of a
real engine measures its tuning as much as its design.

`assert-failed` names the number your model got wrong. Every one follows from the
structure described in the prose rather than from any particular implementation.
