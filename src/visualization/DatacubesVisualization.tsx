import React, { PropsWithChildren } from 'react';

import { ReactFlowState, useStore, XYPosition, useStoreApi, NodeDiffUpdate } from 'react-flow-renderer/nocss';

import shallow from 'zustand/shallow';

import { DatacubesApplication } from './DatacubesApplication';

import { isDatasetNode } from '../data/nodes/DatasetNode';
import { isDateFilterNode } from '../data/nodes/DateFilterNode';
import { isPointPrimitiveNode } from '../data/nodes/PointPrimitiveNode';
import { NodeTypes } from '../data/nodes/enums/NodeTypes';
import { Column as CSVColumn } from '@lukaswagner/csv-parser';
import { ColorPalette } from '../data/nodes/util/EditableColorGradient';
import { serializeColumnInfo } from '../data/nodes/util/serializeColumnInfo';
import { isColorMappingNode } from '../data/nodes/ColorMappingNode';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface DatacubesProps {}

export interface DatacubeInformation {
    id: number;
    position?: XYPosition;
    relativeHeight: number;
    type: NodeTypes;
    isPending?: boolean;
    isErroneous?: boolean;
    xColumn?: CSVColumn;
    yColumn?: CSVColumn;
    zColumn?: CSVColumn;
    sizeColumn?: CSVColumn;
    colors?: {
        column: CSVColumn;
        colorPalette: ColorPalette;
    };
}

const selector = (s: ReactFlowState) => ({
    updateNodePosition: s.updateNodePosition,
    unselectNodesAndEdges: s.unselectNodesAndEdges,
});

export const DatacubesVisualization: React.FC<DatacubesProps> = ({ ...props }: PropsWithChildren<DatacubesProps>) => {
    const store = useStoreApi();
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const spinnerRef = React.useRef<HTMLDivElement | null>(null);
    const [application, setApplication] = React.useState<DatacubesApplication | undefined>(undefined);

    const { updateNodePosition, unselectNodesAndEdges } = useStore(selector, shallow);

    // Initialization -- runs only once (due to the empty list of dependencies passed to useEffect as its 2nd parameter)
    React.useEffect(() => {
        if (canvasRef.current) {
            const exampleInstance = new DatacubesApplication();
            exampleInstance.initialize(canvasRef.current, spinnerRef.current || undefined);
            setApplication(exampleInstance);
            exampleInstance.datacubes$?.subscribe((datacubes: Array<DatacubeInformation>) => {
                unselectNodesAndEdges();

                const nodeInternals = store.getState().nodeInternals;
                nodeInternals.forEach((node) => {
                    const id = parseInt(node.id, 10);
                    const datacube = datacubes.find((dc) => dc.id === id);
                    if (datacube && datacube.position) {
                        const newX = datacube.position.x * REACT_FLOW_CANVAS_STEP + REACT_FLOW_CANVAS_MIN_X;
                        const newY = datacube.position.y * REACT_FLOW_CANVAS_STEP + REACT_FLOW_CANVAS_MIN_Y;

                        const deltaX = newX - node.position.x;
                        const deltaY = newY - node.position.y;

                        if (Math.abs(deltaX) < 1e-3 && Math.abs(deltaY) < 1e-3) {
                            return;
                        }

                        updateNodePosition({
                            id: node.id,
                            diff: { x: deltaX, y: deltaY },
                        } as NodeDiffUpdate);
                    }
                });
            });
        }

        // Commented-out to avoid infinite recursion in application's uninitialization(?)
        // return () => {
        //     if (application) {
        //         application.uninitialize();
        //     }
        // };
    }, []);

    const nodeInformations = useStore((state: ReactFlowState) => {
        const maxRowCounts = Array.from(state.nodeInternals)
            .filter(([, node]) => isDatasetNode(node) || isDateFilterNode(node))
            .map(([, node]) => {
                if (isDatasetNode(node)) {
                    const colRowCounts = node.data.state?.columns?.map((col) => col.length);
                    return Math.max(...(colRowCounts || [0.0]));
                }
                if (isDateFilterNode(node)) {
                    const colRowCounts = node.data.state?.filteredColumns?.map((col) => col.length);
                    return Math.max(...(colRowCounts || [0.0]));
                }
                return 0;
            })
            .filter((maxRowCount) => maxRowCount !== 0);
        const overallMaxRowCount = maxRowCounts.length > 0 ? Math.max(...maxRowCounts) : undefined;
        return Array.from(state.nodeInternals).map(([, node]) => {
            let relativeHeight = 1.0;
            let isErroneous = false;
            let isPending: undefined | boolean = false;
            let xColumn = undefined as undefined | CSVColumn;
            let yColumn = undefined as undefined | CSVColumn;
            let zColumn = undefined as undefined | CSVColumn;
            let sizeColumn = undefined as undefined | CSVColumn;
            let colors = undefined as undefined | { column: CSVColumn; colorPalette: ColorPalette };
            if (isDatasetNode(node) || isDateFilterNode(node) || isPointPrimitiveNode(node) || isColorMappingNode(node)) {
                if (isDatasetNode(node)) {
                    if (overallMaxRowCount) {
                        const colRowCounts = node.data.state?.columns?.map((col) => col.length);
                        if (colRowCounts) {
                            relativeHeight = Math.max(...colRowCounts) / overallMaxRowCount;
                        }
                    }
                    isPending = node.data.state?.isLoading;
                }
                if (isDateFilterNode(node)) {
                    if (overallMaxRowCount) {
                        const colRowCounts = node.data.state?.filteredColumns?.map((col) => col.length);
                        if (colRowCounts) {
                            relativeHeight = Math.max(...colRowCounts) / overallMaxRowCount;
                        }
                    }
                    isErroneous = node.data.state?.errorMessage !== undefined;
                    isPending = node.data.state?.isPending;
                }
                if (isColorMappingNode(node)) {
                    isPending = node.data.state?.isPending;
                }
                if (isPointPrimitiveNode(node)) {
                    isPending = node.data.state?.isPending;
                    xColumn = node.data.state?.xColumn;
                    yColumn = node.data.state?.yColumn;
                    zColumn = node.data.state?.zColumn;
                    sizeColumn = node.data.state?.sizeColumn;
                    colors = node.data.state?.colors;
                }
            }
            return {
                position: node.position,
                id: parseInt(node.id, 10),
                relativeHeight,
                type: node.type,
                isErroneous,
                isPending,
                xColumn,
                yColumn,
                zColumn,
                sizeColumn,
                colors,
            } as DatacubeInformation;
        });
    });

    const REACT_FLOW_CANVAS_MIN_X = 400;
    const REACT_FLOW_CANVAS_MIN_Y = 20;
    const REACT_FLOW_CANVAS_STEP = 300;

    React.useEffect(() => {
        if (application) {
            (application as DatacubesApplication).datacubes = nodeInformations;
        }
    }, [
        application,
        JSON.stringify(
            nodeInformations.map((nodeInfo) => ({
                // Caution: No nodeInfo.position here -> this update is handled in 2nd useEffect hook below!
                id: nodeInfo.id,
                relativeHeight: nodeInfo.relativeHeight,
                type: nodeInfo.type,
                isErroneous: nodeInfo.isErroneous,
                isPending: nodeInfo.isPending,
                xColumn: serializeColumnInfo(nodeInfo.xColumn),
                yColumn: serializeColumnInfo(nodeInfo.yColumn),
                zColumn: serializeColumnInfo(nodeInfo.zColumn),
                sizeColumn: serializeColumnInfo(nodeInfo.sizeColumn),
                colorsLengthAndPalette: nodeInfo.colors
                    ? `${serializeColumnInfo(nodeInfo.colors.column)}_${JSON.stringify(nodeInfo.colors.colorPalette)}`
                    : undefined,
            })),
        ),
    ]);

    React.useEffect(() => {
        if (application) {
            const nodeIdToPositionMap = new Map<number, XYPosition>();
            for (const { position, id } of nodeInformations) {
                if (position) {
                    nodeIdToPositionMap.set(id, {
                        x: (position.x - REACT_FLOW_CANVAS_MIN_X) / REACT_FLOW_CANVAS_STEP,
                        y: (position.y - REACT_FLOW_CANVAS_MIN_Y) / REACT_FLOW_CANVAS_STEP,
                    });
                }
            }
            (application as DatacubesApplication).datacubePositions = nodeIdToPositionMap;
        }
    }, [
        application,
        JSON.stringify(
            nodeInformations.map((nodeInfo) => ({
                id: nodeInfo.id,
                position: nodeInfo.position,
            })),
        ),
    ]);

    return (
        <div className="canvas-container">
            <canvas className="canvas" ref={canvasRef} data-clear-color="0.20392157, 0.22745098, 0.25098039, 1.0" />
            <div className="spinner" ref={spinnerRef}>
                <div></div>
                <div></div>
                <div></div>
                <div></div>
            </div>
            <div className="canvas-overlay">{props.children}</div>
        </div>
    );
};
