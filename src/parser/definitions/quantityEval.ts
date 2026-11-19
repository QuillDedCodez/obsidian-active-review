/** Unit-aware arithmetic for definition expressions that reference quantities. */
import {
    addDim,
    dimEquals,
    scaleDim,
    ZERO_DIM,
    type QuantityValue,
    type UnitExpr,
    type UnitFactor,
} from '../../math/units';

type Value = number | QuantityValue;

const DIMENSIONLESS: UnitExpr = {
    factors: [],
    dim: ZERO_DIM,
    scale: 1,
    namespace: 'si',
};

function isQuantity(value: unknown): value is QuantityValue {
    return typeof value === 'object' && value !== null && 'canonical' in value && 'unit' in value;
}

function mergeFactors(a: UnitExpr, b: UnitExpr, divide: boolean): UnitFactor[] {
    const merged = new Map<string, UnitFactor>();
    const add = (factor: UnitFactor, sign: number): void => {
        const key = `${factor.unit.symbol}|${factor.prefix?.symbol ?? ''}`;
        const existing = merged.get(key);
        if (existing) existing.exponent += factor.exponent * sign;
        else merged.set(key, { ...factor, exponent: factor.exponent * sign });
    };
    for (const factor of a.factors) add(factor, 1);
    for (const factor of b.factors) add(factor, divide ? -1 : 1);
    return [...merged.values()].filter((factor) => factor.exponent !== 0);
}

function combineUnits(a: UnitExpr, b: UnitExpr, divide: boolean): UnitExpr {
    if (a.namespace !== b.namespace) {
        throw new Error('cannot mix SI and abstract units in one quantity expression');
    }
    return {
        factors: mergeFactors(a, b, divide),
        dim: addDim(a.dim, scaleDim(b.dim, divide ? -1 : 1)),
        scale: divide ? a.scale / b.scale : a.scale * b.scale,
        namespace: a.namespace,
    };
}

function powerUnit(unit: UnitExpr, exponent: number): UnitExpr {
    return {
        factors: unit.factors.map((factor) => ({ ...factor, exponent: factor.exponent * exponent })),
        dim: scaleDim(unit.dim, exponent),
        scale: Math.pow(unit.scale, exponent),
        namespace: unit.namespace,
    };
}

function quantity(value: number, unit: UnitExpr = DIMENSIONLESS): QuantityValue {
    return { canonical: value * unit.scale, unit };
}

function asQuantity(value: Value): QuantityValue {
    return isQuantity(value) ? value : quantity(value);
}

function dimensionless(unit: UnitExpr): boolean {
    return unit.dim.every((entry) => entry === 0);
}

function addValues(a: Value, b: Value, sign: 1 | -1): Value {
    if (typeof a === 'number' && typeof b === 'number') return a + sign * b;
    const left = asQuantity(a);
    const right = asQuantity(b);
    if (!dimEquals(left.unit.dim, right.unit.dim)) {
        throw new Error('quantity addition requires the same dimension');
    }
    return {
        canonical: left.canonical + sign * right.canonical,
        unit: left.unit,
        prefix: left.prefix,
    };
}

function multiplyValues(a: Value, b: Value): Value {
    if (typeof a === 'number' && typeof b === 'number') return a * b;
    if (typeof a === 'number') {
        const q = asQuantity(b);
        return { canonical: a * q.canonical, unit: q.unit, prefix: q.prefix };
    }
    if (typeof b === 'number') {
        const q = asQuantity(a);
        return { canonical: q.canonical * b, unit: q.unit, prefix: q.prefix };
    }
    const left = asQuantity(a);
    const right = asQuantity(b);
    return {
        canonical: left.canonical * right.canonical,
        unit: combineUnits(left.unit, right.unit, false),
    };
}

function divideValues(a: Value, b: Value): Value {
    if (typeof a === 'number' && typeof b === 'number') return a / b;
    if (typeof a === 'number') {
        const q = asQuantity(b);
        return {
            canonical: a / q.canonical,
            unit: powerUnit(q.unit, -1),
        };
    }
    if (typeof b === 'number') {
        const q = asQuantity(a);
        return { canonical: q.canonical / b, unit: q.unit, prefix: q.prefix };
    }
    const left = asQuantity(a);
    const right = asQuantity(b);
    return {
        canonical: left.canonical / right.canonical,
        unit: combineUnits(left.unit, right.unit, true),
    };
}

function powerValues(a: Value, exponent: number): Value {
    if (typeof a === 'number') return Math.pow(a, exponent);
    if (!Number.isInteger(exponent)) {
        throw new Error('quantity exponents must be integers');
    }
    const q = asQuantity(a);
    return {
        canonical: Math.pow(q.canonical, exponent),
        unit: powerUnit(q.unit, exponent),
    };
}

class TypedParser {
    private i = 0;

    constructor(
        private readonly source: string,
        private readonly values: Record<string, unknown>,
    ) {}

    parse(): Value {
        const value = this.parseAdditive();
        this.skip();
        if (this.i < this.source.length) {
            throw new Error(`unexpected "${this.source[this.i]}" in quantity expression`);
        }
        return value;
    }

    private skip(): void {
        while (/\s/.test(this.source[this.i] ?? '')) this.i++;
    }

    private peek(): string | undefined {
        return this.source[this.i];
    }

    private readNumber(): number | null {
        const m = /^(\d+\.?\d*|\.\d+)/.exec(this.source.slice(this.i));
        if (!m) return null;
        this.i += m[0].length;
        return Number(m[0]);
    }

    private lastExplicit = false;

    private readName(): string | null {
        this.lastExplicit = false;
        if (this.source.startsWith('\\variable{', this.i) || this.source.startsWith('\\var{', this.i)) {
            const open = this.source.indexOf('{', this.i);
            const close = this.source.indexOf('}', open + 1);
            if (close < 0) throw new Error('missing "}" after \\variable');
            const name = this.source.slice(open + 1, close).trim();
            this.i = close + 1;
            this.lastExplicit = true;
            return name;
        }
        const m = /^[A-Za-z][A-Za-z0-9_]*/.exec(this.source.slice(this.i));
        if (!m) return null;
        this.i += m[0].length;
        return m[0];
    }

    private parseAdditive(): Value {
        let value = this.parseMultiplicative();
        for (;;) {
            this.skip();
            const op = this.peek();
            if (op !== '+' && op !== '-') break;
            this.i++;
            const right = this.parseMultiplicative();
            value = addValues(value, right, op === '+' ? 1 : -1);
        }
        return value;
    }

    private parseMultiplicative(): Value {
        let value = this.parsePower();
        for (;;) {
            this.skip();
            const op = this.peek();
            if (op === '*' || op === '/') {
                this.i++;
                const right = this.parsePower();
                value = op === '*' ? multiplyValues(value, right) : divideValues(value, right);
                continue;
            }
            // Implicit multiplication: 2a, a(b), 2(3).
            if (op !== undefined && /[A-Za-z0-9(\\]/.test(op)) {
                const right = this.parsePower();
                value = multiplyValues(value, right);
                continue;
            }
            break;
        }
        return value;
    }

    private parsePower(): Value {
        let value = this.parseUnary();
        this.skip();
        if (this.peek() === '^') {
            this.i++;
            this.skip();
            // Match the shared math evaluator: `x^{2}` and `x^(2)` mean the same thing.
            const exponent = this.peek() === '{' ? this.parseBracedExponent() : this.parseUnary();
            if (typeof exponent !== 'number') throw new Error('quantity exponent must be a number');
            value = powerValues(value, exponent);
        }
        return value;
    }

    private parseBracedExponent(): Value {
        this.i++; // '{'
        const start = this.i;
        let depth = 1;
        while (depth > 0 && this.i < this.source.length) {
            const ch = this.source[this.i]!;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) break;
            }
            this.i++;
        }
        if (depth !== 0) throw new Error('missing "}" after "^" in quantity expression');
        const inner = this.source.slice(start, this.i);
        this.i++; // '}'
        return new TypedParser(inner, this.values).parse();
    }

    private parseUnary(): Value {
        this.skip();
        if (this.peek() === '-') {
            this.i++;
            const value = this.parseUnary();
            return typeof value === 'number' ? -value : { ...value, canonical: -value.canonical };
        }
        if (this.peek() === '+') {
            this.i++;
            return this.parseUnary();
        }
        return this.parsePrimary();
    }

    private parsePrimary(): Value {
        this.skip();
        const ch = this.peek();
        if (ch === '(') {
            this.i++;
            const value = this.parseAdditive();
            this.skip();
            if (this.peek() !== ')') throw new Error('missing ")" in quantity expression');
            this.i++;
            return value;
        }
        const num = this.readNumber();
        if (num !== null) return num;

        const name = this.readName();
        if (name === null) throw new Error(`unexpected "${ch ?? 'end'}" in quantity expression`);

        this.skip();
        if (this.peek() === '(') {
            this.i++;
            const arg = this.parseAdditive();
            this.skip();
            if (this.peek() !== ')') throw new Error('missing ")" in function call');
            this.i++;
            return this.call(name, arg);
        }

        if (name.length > 1 && !this.lastExplicit) {
            throw new Error(`multi-character variable "${name}" requires \\variable{${name}}`);
        }
        const value = this.values[name];
        if (typeof value === 'number') return value;
        if (isQuantity(value)) return value;
        throw new Error(`"${name}" is not a numeric or quantity definition`);
    }

    private call(name: string, arg: Value): Value {
        switch (name) {
            case 'abs':
                return typeof arg === 'number' ? Math.abs(arg) : { ...arg, canonical: Math.abs(arg.canonical) };
            case 'sqrt': {
                if (typeof arg === 'number') return Math.sqrt(arg);
                const unit = arg.unit;
                if (!unit.dim.every((entry) => entry % 2 === 0)) {
                    throw new Error('sqrt() requires even unit exponents');
                }
                return {
                    canonical: Math.sqrt(arg.canonical),
                    unit: {
                        factors: unit.factors.map((factor) => ({
                            ...factor,
                            exponent: factor.exponent / 2,
                        })),
                        dim: scaleDim(unit.dim, 0.5),
                        scale: Math.sqrt(unit.scale),
                        namespace: unit.namespace,
                    },
                };
            }
            case 'sin':
            case 'cos':
            case 'tan': {
                const q = asQuantity(arg);
                const angle = q.unit.factors.some(
                    (factor) => factor.unit.quantity === 'angle',
                );
                if (!dimensionless(q.unit) && !angle) {
                    throw new Error(`${name}() requires an angle or dimensionless value`);
                }
                const radians = q.canonical;
                return name === 'sin' ? Math.sin(radians) : name === 'cos' ? Math.cos(radians) : Math.tan(radians);
            }
            case 'log':
            case 'ln':
            case 'exp': {
                const q = asQuantity(arg);
                if (!dimensionless(q.unit)) throw new Error(`${name}() requires a dimensionless value`);
                const x = q.canonical;
                return name === 'log' ? Math.log10(x) : name === 'ln' ? Math.log(x) : Math.exp(x);
            }
            case 'min':
            case 'max': {
                if (typeof arg === 'number') return arg;
                return arg;
            }
            default:
                throw new Error(`unsupported quantity function "${name}"`);
        }
    }
}

/** Evaluate one definition expression, returning a number or a quantity. */
export function evaluateQuantityExpression(
    source: string,
    values: Record<string, unknown>,
): Value {
    return new TypedParser(source, values).parse();
}

