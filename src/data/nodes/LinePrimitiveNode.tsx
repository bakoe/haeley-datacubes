import { FC, memo, useEffect } from 'react';
import { Connection, Edge, Handle, Node, Position } from 'react-flow-renderer/nocss';

import { Column as CSVColumn } from '@lukaswagner/csv-parser';

import { NodeWithStateProps } from '../BasicFlow';
import { Datatypes } from './enums/Datatypes';
import { NodeTypes } from './enums/NodeTypes';
import { serializeColumnInfo } from './util/serializeColumnInfo';
import { ColorPalette } from './util/EditableColorGradient';

export function isLinePrimitiveNode(node: Node<unknown>): node is Node<LinePrimitiveNodeData> {
    return node.type === NodeTypes.LinePrimitive;
}

export enum LinePrimitiveNodeTargetHandles {
    X = 'x coordinate',
    Y = 'y coordinate (optional)',
    Z = 'z coordinate (optional)',
    Size = 'size (optional)',
    Color = 'color (optional)',
}

export const LinePrimitiveNodeTargetHandlesDatatypes: Map<LinePrimitiveNodeTargetHandles, Datatypes> = new Map([
    [LinePrimitiveNodeTargetHandles.X, Datatypes.Column],
    [LinePrimitiveNodeTargetHandles.Y, Datatypes.Column],
    [LinePrimitiveNodeTargetHandles.Z, Datatypes.Column],
    [LinePrimitiveNodeTargetHandles.Size, Datatypes.Column],
    [LinePrimitiveNodeTargetHandles.Color, Datatypes.Color],
]);

export interface LinePrimitiveNodeState {
    isPending: boolean;
    xColumn?: CSVColumn;
    yColumn?: CSVColumn;
    zColumn?: CSVColumn;
    sizeColumn?: CSVColumn;
    colors?: {
        column: CSVColumn;
        colorPalette: ColorPalette;
    };
}

export const defaultState = { isPending: true } as LinePrimitiveNodeState;

export interface LinePrimitiveNodeData {
    onChangeState: (state: Partial<LinePrimitiveNodeState>) => void;
    onDeleteNode: () => void;
    state?: LinePrimitiveNodeState;
    isValidConnection?: (connection: Connection) => boolean;
}

type LinePrimitiveNodeProps = NodeWithStateProps<LinePrimitiveNodeData>;

const onConnect = (params: Connection | Edge) => console.log('handle onConnect on LinePrimitiveNode', params);

const LinePrimitiveNode: FC<LinePrimitiveNodeProps> = ({ isConnectable, selected, data }) => {
    const { state, onChangeState, onDeleteNode, isValidConnection } = data;
    const { isPending = true, xColumn = undefined, yColumn = undefined, zColumn = undefined } = { ...defaultState, ...state };

    useEffect(() => {
        if (xColumn) {
            onChangeState({
                isPending: false,
            });
            return;
        }
        onChangeState({
            isPending: true,
        });
    }, [serializeColumnInfo(xColumn), serializeColumnInfo(yColumn), serializeColumnInfo(zColumn)]);

    return (
        <div className={`react-flow__node-default node ${selected && 'selected'} ${isPending && 'pending'} category-rendering`}>
            <div className="title-wrapper">
                <div className="title">Line Primitive{isPending ? ' …' : ''}</div>
                <div className="title-actions">
                    <span>
                        <a onPointerUp={onDeleteNode}>✕</a>
                    </span>
                </div>
            </div>
            {Array.from(LinePrimitiveNodeTargetHandlesDatatypes).map(([targetHandle, datatype]) => {
                return (
                    <div className="handle-wrapper" key={targetHandle}>
                        <Handle
                            type="target"
                            position={Position.Left}
                            id={targetHandle}
                            className={`target-handle ${datatype === Datatypes.Dataset ? 'handle-dataset' : ''}`}
                            isConnectable={isConnectable}
                            onConnect={onConnect}
                            isValidConnection={isValidConnection}
                            data-invalid-connection-tooltip={`You have to connect an output of type “${datatype}” here.`}
                        ></Handle>
                        <span className="target-handle-label">{targetHandle}</span>
                    </div>
                );
            })}
        </div>
    );
};

export default memo(LinePrimitiveNode);
