"""Road graph for the playable Sydney slice.

The game wants *continuous* road centrelines that can be chained into lane
circuits (traffic.js `makeRoadway` takes `points: [[x,z], ...]`). OSM gives
*fragments*: one way per block face, with junctions implied only by shared
coordinates. So the pipeline has to build the graph first and then walk it.

This module does that, and nothing else - no game-specific knowledge.

Coordinate note: our projection already matches the game's
(NORTH = -Z, EAST = +X, metres), so no conversion happens here.
"""

from __future__ import annotations

from collections import defaultdict


def snap_key(x: float, z: float, resolution: float = 0.6) -> tuple[int, int]:
    """Quantise a coordinate so two ways meeting at a junction share a node.

    OSM ways usually share the exact same node, but geometry-only queries
    (`out geom`) give floating point that can differ by a few centimetres, and
    bridges/ramps can be split at slightly different points. 0.6 m is fine
    enough to keep a street intact and coarse enough to join its neighbours.
    """
    return (int(round(x / resolution)), int(round(z / resolution)))


class RoadGraph:
    """An undirected graph of road fragments, built from OSM ways.

    nodes: snapped coordinate -> node id
    edges: (u, v) -> list of way ids (several ways can share a pair, e.g. a
           bridge and the road under it)
    """

    def __init__(self, resolution: float = 0.6):
        self.resolution = resolution
        self.node_xy: dict[tuple[int, int], tuple[float, float]] = {}
        self.edges: dict[tuple[tuple, tuple], list[int]] = defaultdict(list)
        self.ways: list[dict] = []
        self.node_ways: dict[tuple[int, int], set] = defaultdict(set)

    def add_way(self, way: dict) -> None:
        """`way` needs `geometryLocal` ([[x,0,z], ...]) and ideally an id."""
        points = [(p[0], p[2]) for p in way.get("geometryLocal") or []]
        if len(points) < 2:
            return
        nodes = [self._node(x, z) for x, z in points]
        way_index = len(self.ways)
        self.ways.append(way)
        for a, b in zip(nodes, nodes[1:]):
            key = (a, b) if a <= b else (b, a)
            self.edges[key].append(way_index)
            self.node_ways[a].add(way_index)
            self.node_ways[b].add(way_index)

    def _node(self, x: float, z: float) -> tuple[int, int]:
        key = snap_key(x, z, self.resolution)
        if key not in self.node_xy:
            self.node_xy[key] = (x, z)
        return key

    # --------------------------------------------------------- analysis --
    def components(self) -> list[set]:
        """Connected sets of node keys."""
        seen: set = set()
        out: list[set] = []
        for start in self.node_xy:
            if start in seen:
                continue
            stack = [start]
            group = set()
            seen.add(start)
            while stack:
                node = stack.pop()
                group.add(node)
                for neighbour in self._neighbours(node):
                    if neighbour not in seen:
                        seen.add(neighbour)
                        stack.append(neighbour)
            out.append(group)
        return out

    def _neighbours(self, node):
        for (a, b) in self.edges:
            if a == node:
                yield b
            elif b == node:
                yield a

    def degree(self, node) -> int:
        return len(self._neighbours(node))

    def describe(self) -> dict:
        components = self.components()
        components.sort(key=len, reverse=True)
        node_count = len(self.node_xy)
        biggest = len(components[0]) if components else 0
        return {
            "nodes": node_count,
            "edges": len(self.edges),
            "ways": len(self.ways),
            "components": len(components),
            "largestComponentNodes": biggest,
            "largestComponentShare": round(biggest / node_count, 4) if node_count else 0.0,
            "componentSizes": [len(c) for c in components[:20]],
            "orphanNodes": sum(1 for n in self.node_xy if not self._neighbours(n)),
        }

    # --------------------------------------------------------- walking --
    def chain(self, start_node, first_edge_key) -> tuple[list[tuple[int, int]], list[int]]:
        """Walk a path from `start_node` along `first_edge_key`, continuing
        through degree-2 nodes. At a junction (degree > 2) the walk stops, so
        the result is a maximal run of road with no decisions in it.

        Returns (node path, way ids used).
        """
        path = [start_node]
        used_ways: list[int] = []
        node = start_node
        edge_key = first_edge_key
        guard = 0
        while guard < 10_000:
            guard += 1
            a, b = edge_key
            # the edge we arrive at must touch the node we are standing on
            node = a if a != path[-1] else b
            next_node = b if node == a else a
            ways = self.edges[edge_key]
            used_ways.append(ways[0])
            path.append(next_node)
            if self.degree(next_node) != 2:
                break
            # continue through the degree-2 node along its other edge
            nxt = None
            for key in self._neighbour_edges(next_node):
                if key != edge_key:
                    nxt = key
                    break
            if nxt is None:
                break
            edge_key = nxt
        return path, used_ways

    def _neighbour_edges(self, node):
        for key in self.edges:
            if node in key:
                yield key
