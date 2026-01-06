import { useEffect, useRef, useState, memo } from 'react';
import mermaid from 'mermaid';
import styled from 'styled-components';

// Initialize mermaid with dark theme settings
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#fabd2f',
    primaryTextColor: '#ebdbb2',
    primaryBorderColor: '#fabd2f',
    lineColor: '#ebdbb2',
    secondaryColor: '#3c3836',
    tertiaryColor: '#504945',
    background: '#282828',
    mainBkg: '#3c3836',
    secondBkg: '#504945',
    nodeBorder: '#fabd2f',
    clusterBkg: '#3c3836',
    clusterBorder: '#504945',
    titleColor: '#fabd2f',
    edgeLabelBackground: '#282828',
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis',
  },
});

const MermaidContainer = styled.div`
  margin: 1.5rem 0;
  padding: 1rem;
  background: ${({ theme }) => theme.colors.text[300]}15;
  border-radius: 6px;
  overflow-x: auto;

  svg {
    max-width: 100%;
    height: auto;
  }

  /* Override mermaid's inline styles for better theme integration */
  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path {
    stroke: ${({ theme }) => theme.colors.primary} !important;
  }

  .edgePath .path {
    stroke: ${({ theme }) => theme.colors.text[200]} !important;
  }

  .label {
    color: ${({ theme }) => theme.colors.text[100]} !important;
  }
`;

const ErrorContainer = styled.div`
  color: ${({ theme }) => theme.colors.text[300]};
  padding: 1rem;
  background: ${({ theme }) => theme.colors.text[300]}10;
  border-left: 3px solid ${({ theme }) => theme.colors.text[300]};
  border-radius: 0 4px 4px 0;
  font-size: 0.9rem;
`;

interface MermaidProps {
  chart: string;
}

// Counter to ensure unique IDs across renders
let mermaidIdCounter = 0;

const Mermaid: React.FC<MermaidProps> = memo(({ chart }) => {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const idRef = useRef(`mermaid-${++mermaidIdCounter}-${Date.now()}`);

  useEffect(() => {
    let isMounted = true;

    const renderChart = async () => {
      try {
        setIsRendering(true);
        setError(null);

        // Generate a unique ID for this render
        const renderId = `mermaid-${++mermaidIdCounter}-${Date.now()}`;
        idRef.current = renderId;

        // Render the mermaid diagram
        const { svg } = await mermaid.render(renderId, chart);

        // Only update state if component is still mounted
        if (isMounted) {
          setSvgContent(svg);
          setIsRendering(false);
        }
      } catch (err) {
        if (isMounted) {
          const message = err instanceof Error ? err.message : 'Failed to render diagram';
          setError(message);
          setIsRendering(false);
        }
      }
    };

    renderChart();

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (error) {
    return (
      <ErrorContainer>
        <div>Diagram rendering failed: {error}</div>
        <pre style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
          <code>{chart}</code>
        </pre>
      </ErrorContainer>
    );
  }

  if (isRendering || !svgContent) {
    return <MermaidContainer>Loading diagram...</MermaidContainer>;
  }

  return <MermaidContainer dangerouslySetInnerHTML={{ __html: svgContent }} />;
});

Mermaid.displayName = 'Mermaid';

export default Mermaid;
