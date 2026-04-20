export class GeometryPreprocessor {
    constructor(options = {}) {
        this.options = {
            epsilon: options.epsilon ?? 1e-6,
            angleToleranceDeg: options.angleToleranceDeg ?? 0.5,
            distanceTolerance: options.distanceTolerance ?? 1e-4,
            minSegmentLength: options.minSegmentLength ?? 1e-4,
        };
        this.angleToleranceRad = (this.options.angleToleranceDeg * Math.PI) / 180;
    }

    preprocessEntities(entities = []) {
        const stats = {
            entitiesIn: entities.length,
            entitiesOut: 0,
            verticesIn: 0,
            verticesOut: 0,
            removedVertices: 0,
        };

        const cleaned = [];

        for (const entity of entities) {
            const sourcePoints = entity?.points || entity?.vertices;
            if (!Array.isArray(sourcePoints) || sourcePoints.length === 0) continue;

            stats.verticesIn += sourcePoints.length;

            const closed = Boolean(entity.closed || entity.shape);
            let points = this.normalizePoints(sourcePoints);
            if (points.length < 2) continue;

            points = this.removeConsecutiveDuplicates(points, closed);
            points = this.removeTinySegments(points, closed);
            points = this.simplifyCollinear(points, closed);
            points = this.removeConsecutiveDuplicates(points, closed);

            if (points.length < 2) continue;

            const target = { ...entity };
            if ('points' in entity || !('vertices' in entity)) target.points = points;
            if ('vertices' in entity) target.vertices = points;

            if ((entity.closed || entity.shape) && points.length < 3) {
                target.closed = false;
                target.shape = false;
            }

            cleaned.push(target);
            stats.verticesOut += points.length;
        }

        stats.entitiesOut = cleaned.length;
        stats.removedVertices = Math.max(0, stats.verticesIn - stats.verticesOut);

        return { entities: cleaned, stats };
    }

    normalizePoints(points) {
        return points
            .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    }

    removeConsecutiveDuplicates(points, closed) {
        if (points.length <= 1) return points.slice();

        const cleaned = [];
        const epsSq = this.options.epsilon * this.options.epsilon;

        for (const point of points) {
            const last = cleaned[cleaned.length - 1];
            if (!last || this.distanceSq(last, point) > epsSq) {
                cleaned.push(point);
            }
        }

        if (closed && cleaned.length > 2) {
            const first = cleaned[0];
            const last = cleaned[cleaned.length - 1];
            if (this.distanceSq(first, last) <= epsSq) cleaned.pop();
        }

        return cleaned;
    }

    removeTinySegments(points, closed) {
        if (points.length <= 2) return points.slice();

        const minLenSq = this.options.minSegmentLength * this.options.minSegmentLength;
        const result = [];

        if (!closed) result.push(points[0]);

        for (let i = 0; i < points.length; i++) {
            const prev = points[(i - 1 + points.length) % points.length];
            const curr = points[i];
            const next = points[(i + 1) % points.length];
            const isEndpoint = !closed && (i === 0 || i === points.length - 1);

            if (isEndpoint) {
                if (i === points.length - 1) result.push(curr);
                continue;
            }

            const prevLenSq = this.distanceSq(prev, curr);
            const nextLenSq = this.distanceSq(curr, next);
            if (prevLenSq <= minLenSq || nextLenSq <= minLenSq) continue;

            result.push(curr);
        }

        return result.length >= 2 ? result : points.slice();
    }

    simplifyCollinear(points, closed) {
        if (points.length <= (closed ? 3 : 2)) return points.slice();

        if (!closed) return this.simplifyOpenPolyline(points);

        let current = points.slice();
        let changed = true;
        while (changed && current.length > 3) {
            changed = false;
            const next = [];
            for (let i = 0; i < current.length; i++) {
                const prev = current[(i - 1 + current.length) % current.length];
                const curr = current[i];
                const nxt = current[(i + 1) % current.length];
                if (this.canDropCollinear(prev, curr, nxt)) {
                    changed = true;
                    continue;
                }
                next.push(curr);
            }
            if (next.length < 3) break;
            current = next;
        }
        return current;
    }

    simplifyOpenPolyline(points) {
        if (points.length <= 2) return points.slice();

        const result = [points[0]];
        for (let i = 1; i < points.length - 1; i++) {
            const prev = result[result.length - 1];
            const curr = points[i];
            const next = points[i + 1];
            if (this.canDropCollinear(prev, curr, next)) continue;
            result.push(curr);
        }
        result.push(points[points.length - 1]);
        return result;
    }

    canDropCollinear(a, b, c) {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const bcx = c.x - b.x;
        const bcy = c.y - b.y;
        const acx = c.x - a.x;
        const acy = c.y - a.y;

        const lenAB = Math.hypot(abx, aby);
        const lenBC = Math.hypot(bcx, bcy);
        const lenAC = Math.hypot(acx, acy);
        if (lenAB <= this.options.minSegmentLength || lenBC <= this.options.minSegmentLength || lenAC <= this.options.minSegmentLength) {
            return true;
        }

        const cross = Math.abs((abx * acy) - (aby * acx));
        const perpendicularDistance = cross / lenAC;
        if (perpendicularDistance > this.options.distanceTolerance) return false;

        const dot = (abx * bcx) + (aby * bcy);
        if (dot < 0) return false;

        const sinTheta = cross / (lenAB * lenAC);
        return sinTheta <= Math.sin(this.angleToleranceRad);
    }

    distanceSq(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return (dx * dx) + (dy * dy);
    }
}
