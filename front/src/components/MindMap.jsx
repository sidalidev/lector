import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as d3 from 'd3';
import { t } from '../services/i18n'
import './MindMap.css';

// Simple fuzzy match: check if concept name loosely matches a header text
function fuzzyMatch(conceptName, headerText) {
  const a = conceptName.toLowerCase().replace(/[^a-zà-ÿ0-9\s]/g, '').trim();
  const b = headerText.toLowerCase().replace(/[^a-zà-ÿ0-9\s]/g, '').trim();
  if (a === b) return true;
  if (b.includes(a) || a.includes(b)) return true;
  // Check word overlap
  const wordsA = a.split(/\s+/);
  const wordsB = new Set(b.split(/\s+/));
  const overlap = wordsA.filter(w => w.length > 2 && wordsB.has(w)).length;
  return overlap >= Math.min(2, wordsA.length);
}

const MindMapComponent = forwardRef(function MindMapComponent({ onNavigate, headers = [], aiConcepts, aiStatus, zoomEnabled = true }, ref) {
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const gRef = useRef(null);
  const renderHashRef = useRef('');

  const status = aiStatus || null;
  const concepts = aiConcepts || null;

  const recenter = useCallback(() => {
    if (!svgRef.current || !gRef.current || !zoomRef.current) return;

    const svg = d3.select(svgRef.current);
    const g = gRef.current;
    const zoom = zoomRef.current;

    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    const bounds = g.node().getBBox();
    const fullWidth = bounds.width;
    const fullHeight = bounds.height;
    const midX = bounds.x + fullWidth / 2;
    const midY = bounds.y + fullHeight / 2;

    const scale = Math.min(
      0.85 * width / fullWidth,
      0.85 * height / fullHeight,
      1
    );

    const transform = d3.zoomIdentity
      .translate(width / 2 - midX * scale, height / 2 - midY * scale)
      .scale(scale);

    svg.transition().duration(300).call(zoom.transform, transform);
  }, []);

  useImperativeHandle(ref, () => ({
    recenter
  }), [recenter]);

  // Plus d'auto-génération ni de fallback markdown
  // Le parent (DocumentView) gère l'état IA via aiStatus/aiConcepts

  // Convert AI concepts to tree structure
  const conceptsToTree = useCallback((conceptData) => {
    if (!conceptData) return null;

    const root = {
      name: conceptData.central || 'Document',
      children: (conceptData.branches || []).map((branch, idx) => ({
        name: branch.name,
        id: `concept-${idx}`,
        children: (branch.children || []).map((child, childIdx) => ({
          name: child,
          id: `concept-${idx}-${childIdx}`,
          children: []
        }))
      }))
    };

    return root;
  }, []);

  // Find matching header for an AI concept name
  const findMatchingHeader = useCallback((conceptName) => {
    if (!headers || headers.length === 0) return null;
    for (const h of headers) {
      if (fuzzyMatch(conceptName, h.text)) {
        return h.id;
      }
    }
    return null;
  }, [headers]);

  // Render mind map: uniquement si concepts IA disponibles
  useEffect(() => {
    if (!svgRef.current) return;
    if (status !== 'ready' || !concepts) {
      // Pas de concepts → vider le SVG
      d3.select(svgRef.current).selectAll('*').remove();
      renderHashRef.current = '';
      return;
    }

    const renderKey = JSON.stringify(concepts).slice(0, 200);
    if (renderKey === renderHashRef.current) return;
    renderHashRef.current = renderKey;

    const data = conceptsToTree(concepts);
    if (!data) return;

    // Clear previous
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    const g = svg.append('g');
    gRef.current = g;

    let rootNode = data;
    let rootName = data.name;

    const children = rootNode.children || [];

    const getWeight = (node) => {
      if (!node.children || node.children.length === 0) return 1;
      return 1 + node.children.reduce((sum, child) => sum + getWeight(child), 0);
    };

    const weightedChildren = children.map((child, idx) => ({
      child,
      weight: getWeight(child),
      originalIndex: idx
    }));

    let leftWeight = 0;
    let rightWeight = 0;
    const leftChildren = [];
    const rightChildren = [];

    weightedChildren.forEach((item) => {
      if (leftWeight <= rightWeight) {
        leftChildren.push(item.child);
        leftWeight += item.weight;
      } else {
        rightChildren.push(item.child);
        rightWeight += item.weight;
      }
    });

    const leftData = { ...rootNode, name: rootName, children: leftChildren };
    const rightData = { ...rootNode, name: rootName, children: rightChildren };

    const treeLayout = d3.tree().nodeSize([40, 180]);

    const leftRoot = d3.hierarchy(leftData);
    treeLayout(leftRoot);

    const rightRoot = d3.hierarchy(rightData);
    treeLayout(rightRoot);

    const cs = getComputedStyle(document.documentElement);
    const accentColor = cs.getPropertyValue('--accent').trim() || '#E9A23B';
    const textColor = cs.getPropertyValue('--text-primary').trim() || '#1F2A22';
    const bgColor = cs.getPropertyValue('--bg-primary').trim() || '#FBF7EF';

    // Couleurs de la famille sidali.dev : miel, sapin, lac, lavande, or romain.
    const aiColors = ['#E9A23B', '#2F5D46', '#2E7FA1', '#7A6FB0', '#B8892A'];
    const getColor = (depth) => aiColors[depth % aiColors.length];
    // Texte sur la pastille : encre sur miel et or, crème sur sapin, lac, lavande.
    const getOnColor = (depth) => ([0, 4].includes(depth % aiColors.length) ? '#1F2A22' : '#FBF7EF');

    // Track node positions for relations
    const nodePositions = new Map();

    // Draw curved links
    const drawLinks = (root, direction) => {
      const multiplier = direction === 'left' ? -1 : 1;

      g.selectAll(`.link-${direction}`)
        .data(root.links())
        .enter()
        .append('path')
        .attr('class', `link link-${direction}`)
        .attr('fill', 'none')
        .attr('stroke', d => getColor(d.source.depth))
        .attr('stroke-width', d => Math.max(1, 4 - d.source.depth))
        .attr('stroke-opacity', 0.6)
        .attr('d', d => {
          const sx = d.source.y * multiplier;
          const sy = d.source.x;
          const tx = d.target.y * multiplier;
          const ty = d.target.x;
          const midX = (sx + tx) / 2;
          return `M${sx},${sy} C${midX},${sy} ${midX},${ty} ${tx},${ty}`;
        });
    };

    // Draw nodes
    const drawNodes = (root, direction, skipRoot = false) => {
      const multiplier = direction === 'left' ? -1 : 1;

      const nodeData = skipRoot
        ? root.descendants().filter(d => d.depth > 0)
        : root.descendants();

      const nodes = g.selectAll(`.node-${direction}`)
        .data(nodeData)
        .enter()
        .append('g')
        .attr('class', `node node-${direction}`)
        .attr('transform', d => {
          const x = d.y * multiplier;
          const y = d.x;
          // Store position for relations
          nodePositions.set(d.data.name, { x, y });
          return `translate(${x},${y})`;
        })
        .style('cursor', d => {
          if (findMatchingHeader(d.data.name)) return 'pointer';
          return 'default';
        })
        .on('click', (event, d) => {
          if (onNavigate) {
            const matchedId = findMatchingHeader(d.data.name);
            if (matchedId) onNavigate(matchedId);
          }
        });

      nodes.append('rect')
        .attr('class', 'text-bg')
        .attr('fill', bgColor)
        .attr('rx', 4)
        .attr('ry', 4);

      nodes.append('circle')
        .attr('r', 5)
        .attr('fill', bgColor)
        .attr('stroke', d => getColor(d.depth))
        .attr('stroke-width', 2);

      nodes.append('text')
        .attr('dy', '0.35em')
        .attr('x', direction === 'left' ? -12 : 12)
        .attr('text-anchor', direction === 'left' ? 'end' : 'start')
        .attr('font-size', d => d.depth === 1 ? '14px' : '12px')
        .attr('font-weight', d => d.depth === 1 ? '600' : '400')
        .attr('fill', textColor)
        .text(d => d.data.name);

      // Complexity badge: show child count on branches with >= 2 children
      nodes.each(function(d) {
        if (d.data.children && d.data.children.length >= 2 && d.depth === 1) {
          const node = d3.select(this);
          node.append('circle')
            .attr('class', 'complexity-badge')
            .attr('cx', direction === 'left' ? 10 : -10)
            .attr('cy', -12)
            .attr('r', 8)
            .attr('fill', getColor(d.depth))
            .attr('opacity', 1);

          node.append('text')
            .attr('class', 'complexity-count')
            .attr('x', direction === 'left' ? 10 : -10)
            .attr('y', -12)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('font-size', '9px')
            .attr('font-weight', '700')
            .attr('fill', getOnColor(d.depth))
            .text(d.data.children.length);
        }
      });

      nodes.each(function() {
        const node = d3.select(this);
        const text = node.select('text');
        const bbox = text.node().getBBox();
        node.select('.text-bg')
          .attr('x', bbox.x - 4)
          .attr('y', bbox.y - 2)
          .attr('width', bbox.width + 8)
          .attr('height', bbox.height + 4);
      });
    };

    if (leftChildren.length > 0) {
      drawLinks(leftRoot, 'left');
    }
    if (rightChildren.length > 0) {
      drawLinks(rightRoot, 'right');
    }

    if (leftChildren.length > 0) {
      drawNodes(leftRoot, 'left', true);
    }
    if (rightChildren.length > 0) {
      drawNodes(rightRoot, 'right', true);
    }

    // Draw inter-branch relations (dashed curves)
    if (status === 'ready' && concepts?.relations) {
      for (const rel of concepts.relations) {
        const fromPos = nodePositions.get(rel.from);
        const toPos = nodePositions.get(rel.to);
        if (fromPos && toPos) {
          const midY = (fromPos.y + toPos.y) / 2;
          const offsetX = (fromPos.x + toPos.x) / 2;
          const curveOffset = Math.abs(fromPos.y - toPos.y) * 0.3 + 30;

          g.append('path')
            .attr('class', 'relation-line')
            .attr('fill', 'none')
            .attr('stroke', cs.getPropertyValue('--text-muted').trim() || '#5F6E64')
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4,4')
            .attr('stroke-opacity', 0.5)
            .attr('d', `M${fromPos.x},${fromPos.y} Q${offsetX},${midY - curveOffset} ${toPos.x},${toPos.y}`);
        }
      }
    }

    // Draw center root node
    const rootGroup = g.append('g')
      .attr('class', 'root-node')
      .style('cursor', 'default');

    const rootColor = accentColor;

    rootGroup.append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', 14)
      .attr('fill', rootColor)
      .attr('stroke', bgColor)
      .attr('stroke-width', 3);

    rootGroup.append('text')
      .attr('x', 0)
      .attr('y', -28)
      .attr('text-anchor', 'middle')
      .attr('font-size', '15px')
      .attr('font-weight', '700')
      .attr('fill', rootColor)
      .text(rootName);

    // Setup zoom (only when zoomEnabled, e.g. fullscreen mode)
    const zoom = d3.zoom()
      .scaleExtent([0.1, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    zoomRef.current = zoom;

    if (zoomEnabled) {
      svg.call(zoom)
        .on('dblclick.zoom', null);
    } else {
      // Disable all zoom/drag interaction: let scroll pass through to parent
      svg.on('.zoom', null);
      svg.on('wheel', null);
      svg.on('mousedown', null);
      svg.on('touchstart', null);
      svg.on('touchmove', null);
    }

    // Initial fit
    setTimeout(() => {
      const bounds = g.node().getBBox();
      const fullWidth = bounds.width;
      const fullHeight = bounds.height;
      const midX = bounds.x + fullWidth / 2;
      const midY = bounds.y + fullHeight / 2;

      const scale = Math.min(
        0.85 * width / fullWidth,
        0.85 * height / fullHeight,
        1
      );

      const transform = d3.zoomIdentity
        .translate(width / 2 - midX * scale, height / 2 - midY * scale)
        .scale(scale);

      svg.transition().duration(300).call(zoom.transform, transform);
    }, 100);

  }, [status, concepts, onNavigate, conceptsToTree, findMatchingHeader, headers]);

  // Pas de concepts IA → état vide (le bouton Générer est dans DocumentView)
  if (status !== 'ready' || !concepts) {
    return (
      <div className="mindmap-wrapper mindmap-empty">
        {status === 'loading' ? (
          <div className="mindmap-loading">
            <div className="mindmap-spinner"></div>
            <span>{t('mindmap.analyzing')}</span>
          </div>
        ) : (
          <div className="mindmap-empty-state">
            <span className="mindmap-empty-icon">🧠</span>
            <span className="mindmap-empty-text">{t('mindmap.empty')}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mindmap-wrapper">
      <svg ref={svgRef} className="mindmap-svg" style={{ touchAction: zoomEnabled ? 'none' : 'pan-y' }} />
      <button className="mindmap-recenter-btn" onClick={recenter} title={t('mindmap.recenter')}>
        ⌖
      </button>
    </div>
  );
});

export default MindMapComponent;
