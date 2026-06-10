import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MediaFrame } from '@/components/landing/MediaFrame';

describe('MediaFrame', () => {
  it('renders a labelled placeholder when no src is given', () => {
    render(<MediaFrame label="Pipeline kanban" />);
    expect(screen.getByText('Pipeline kanban')).toBeInTheDocument();
    expect(screen.getByText('Demo coming soon')).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders a video when a src is provided', () => {
    render(<MediaFrame label="Demo" src="/demo.mp4" poster="/poster.png" />);
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', '/demo.mp4');
    expect(video).toHaveAttribute('poster', '/poster.png');
    expect(screen.queryByText('Demo coming soon')).toBeNull();
  });

  it('renders an image when image is true', () => {
    render(<MediaFrame label="Screenshot" src="/shot.png" image />);
    const img = screen.getByRole('img', { name: 'Screenshot' });
    expect(img).toHaveAttribute('src', '/shot.png');
    expect(document.querySelector('video')).toBeNull();
  });
});
