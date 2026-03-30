# General Intelligence — Train LLMs toward AGI-level reasoning

Train and evaluate language models on a diverse suite of benchmarks that
measure general intelligence: abstract reasoning, mathematical problem-solving,
common-sense inference, code generation, and scientific understanding.

## Objective

Maximize a **composite general-intelligence score** across multiple benchmarks
that together approximate broad cognitive capability.

## Benchmarks

| Benchmark | Measures | Baseline |
|-----------|----------|----------|
| **ARC-AGI 2** | Abstract reasoning & novel pattern generalization | 0.12 |
| **GPQA (Diamond)** | Graduate-level science Q&A | 0.28 |
| **MATH-500** | Competition-level mathematics | 0.34 |
| **HumanEval+** | Code synthesis from docstrings | 0.42 |
| **MMLU-Pro** | Massive multitask language understanding (hard) | 0.38 |
| **BBH (BIG-Bench Hard)** | Challenging compositional reasoning | 0.35 |
| **DROP** | Discrete reasoning over paragraphs | 0.40 |
| **HellaSwag** | Common-sense natural language inference | 0.62 |

## Composite Score

```
composite = 0.25 × arc_agi2
           + 0.15 × gpqa
           + 0.15 × math500
           + 0.10 × humaneval
           + 0.10 × mmlu_pro
           + 0.10 × bbh
           + 0.08 × drop
           + 0.07 × hellaswag
```

ARC-AGI 2 is weighted highest because abstract reasoning on novel tasks is the
closest proxy we have for general intelligence.

## What to explore

- Model architecture: decoder-only vs. mixture-of-experts
- Reasoning scaffolds: chain-of-thought, self-consistency, tree-of-thought
- Training data mixes: ratio of code/math/science/reasoning data
- LoRA rank, alpha, and target modules
- Curriculum learning: easy-to-hard scheduling
- Inference-time compute: best-of-N sampling, verifier-guided search
- Knowledge distillation from larger models
- Synthetic data augmentation for reasoning tasks

## Dataset

A curated mix of open reasoning datasets:
- ARC training set (abstraction & reasoning)
- GSM8K + MATH (mathematical reasoning)
- OpenBookQA + SciQ (science)
- Code-Alpaca + Evol-Instruct (code)
- ShareGPT-filtered (general instruction following)
