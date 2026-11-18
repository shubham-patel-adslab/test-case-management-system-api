// A seeded pseudo-random generator (mulberry32): the same seed gives the same demo data on every run and every
// machine, so screenshots, the user guide and a re-seeded demo match. Not for anything security-related.
export type Random = {
    // [0, 1)
    next(): number;
    // Integer in [min, max], both included.
    int(min: number, max: number): number;
    chance(probability: number): boolean;
    pick<T>(items: readonly T[]): T;
    // One value, chosen in proportion to its weight.
    weighted<T>(entries: readonly (readonly [T, number])[]): T;
};

export function createRandom(seed: number): Random {
    let state = seed >>> 0;

    const next = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

        return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };

    const pick = <T>(items: readonly T[]): T => {
        const item = items[Math.floor(next() * items.length)];

        if (item === undefined) {
            throw new Error('pick() from an empty list');
        }

        return item;
    };

    return {
        next,
        int: (min, max) => min + Math.floor(next() * (max - min + 1)),
        chance: (probability) => next() < probability,
        pick,
        weighted: (entries) => {
            const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
            let threshold = next() * total;

            for (const [value, weight] of entries) {
                threshold -= weight;

                if (threshold < 0) {
                    return value;
                }
            }

            return pick(entries)[0];
        },
    };
}
