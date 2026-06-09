import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makeApp } from '../test-utils';
import { Pipeline } from '@/pages/Pipeline';

// Capture the DndContext callbacks so we can drive drag/drop without a real pointer.
let dndProps: { onDragStart?: (e: unknown) => void; onDragEnd?: (e: unknown) => void } = {};
vi.mock('@dnd-kit/core', () => ({
  DndContext: (props: { children: React.ReactNode; onDragStart?: never; onDragEnd?: never }) => {
    dndProps = props;
    return <div data-testid="dnd">{props.children}</div>;
  },
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Translate: { toString: () => '' } } }));

const useApplications = vi.fn();
const updateMutate = vi.fn();
vi.mock('@/hooks/useApplications', () => ({
  useApplications: () => useApplications(),
  useUpdateApplication: () => ({ mutate: updateMutate }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  dndProps = {};
});

describe('Pipeline', () => {
  it('shows a spinner while loading', () => {
    useApplications.mockReturnValue({ data: [], isLoading: true });
    const { container } = renderWithProviders(<Pipeline />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders pipeline columns and places cards in them', () => {
    useApplications.mockReturnValue({
      data: [makeApp({ appId: 'a1', company: 'Acme', status: 'applied' })],
      isLoading: false,
    });
    renderWithProviders(<Pipeline />);
    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.getByText('Screening')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('expands the terminal "Closed" section', async () => {
    useApplications.mockReturnValue({
      data: [makeApp({ company: 'GoneCo', status: 'rejected' })],
      isLoading: false,
    });
    renderWithProviders(<Pipeline />);
    const toggle = screen.getByRole('button', { name: /closed \(1\)/i });
    await userEvent.click(toggle);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('GoneCo')).toBeInTheDocument();
  });

  it('updates status when a card is dropped on a different column', () => {
    useApplications.mockReturnValue({
      data: [makeApp({ appId: 'a1', status: 'applied' })],
      isLoading: false,
    });
    renderWithProviders(<Pipeline />);

    act(() => dndProps.onDragStart!({ active: { id: 'a1' } }));
    act(() => dndProps.onDragEnd!({ active: { id: 'a1' }, over: { id: 'screening' } }));

    expect(updateMutate).toHaveBeenCalledWith({ appId: 'a1', status: 'screening' });
  });

  it('does nothing when dropped on the same column', () => {
    useApplications.mockReturnValue({
      data: [makeApp({ appId: 'a1', status: 'applied' })],
      isLoading: false,
    });
    renderWithProviders(<Pipeline />);
    act(() => dndProps.onDragEnd!({ active: { id: 'a1' }, over: { id: 'applied' } }));
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('does nothing when dropped outside any column', () => {
    useApplications.mockReturnValue({
      data: [makeApp({ appId: 'a1', status: 'applied' })],
      isLoading: false,
    });
    renderWithProviders(<Pipeline />);
    act(() => dndProps.onDragEnd!({ active: { id: 'a1' }, over: null }));
    expect(updateMutate).not.toHaveBeenCalled();
  });
});
