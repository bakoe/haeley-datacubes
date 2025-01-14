import { memo, FC, CSSProperties, useEffect, useState } from 'react';

import { Handle, Position, Node, Connection } from 'react-flow-renderer/nocss';

import { Collapse } from 'react-collapse';

import {
    Column as CSVColumn,
    ColumnHeader as CSVColumnHeader,
    CSV,
    DataType,
    DateColumn,
    Float32Chunk,
    Float32Column,
    NumberColumn,
    SheetInput,
    StringChunk,
    StringColumn,
} from '@lukaswagner/csv-parser';
import Papa from 'papaparse';

export function isDatasetNode(node: Node<unknown>): node is Node<DatasetNodeData> {
    return node.type === 'dataset';
}

// Workaround to use papaparse instead of @lukaswagner/csv-parser for the time being,
// due to problems with nested worker imports in Vite
const USE_CSV_PARSER_INSTEAD_OF_PAPAPARSE = true;

import { NodeWithStateProps } from '../BasicFlow';
import CollapsibleHandle from './util/CollapsibleHandle';
import { prettyPrintDataType } from './util/prettyPrintDataType';
import { DateTime } from 'luxon';

const nodeStyleOverrides: CSSProperties = { width: '250px' };

interface Column {
    type: 'string' | 'number';
    name: string;
}

export const makeTypeHumanReadable = (type: DatasetNodeValidTypes): string | undefined => {
    switch (type) {
        case 'csv':
            return 'CSV';
        case 'json':
            return 'JSON';
        case 'google-sheets':
            return 'Google Sheets';
        default:
            return undefined;
    }
};

export type DatasetNodeValidTypes = 'csv' | 'json' | 'google-sheets' | undefined;

export const getDistinctValuesInStringColumn = (column: StringColumn): string[] => {
    const data = column.chunks.map((chunk) => (chunk as StringChunk as any)._data).flat();
    return Array.from(new Set(data));
};

export interface DatasetNodeState {
    type: DatasetNodeValidTypes;
    columnHeaders?: CSVColumnHeader[];
    columns?: CSVColumn[];
    isLoading?: boolean;
    remoteUri?: string;
    googleSheetsUri?: string;
    forceRefreshGoogleSheets?: boolean;
    includesHeader?: boolean;
    delimiter?: string;
}

export const defaultState = { isLoading: true } as DatasetNodeState;

export interface DatasetNodeData {
    filename: string;
    onChangeState: (state: Partial<DatasetNodeState>) => void;
    onDeleteNode: () => void;
    state?: DatasetNodeState;
    isValidConnection?: (connection: Connection) => boolean;
    columns?: Column[];
    file?: File;
}

export const mapMimetypeToNodeFiletype = (mimeType: string): DatasetNodeValidTypes | undefined => {
    switch (mimeType) {
        case 'text/csv':
            return 'csv';
        case 'application/json':
            return 'json';
        default:
            return undefined;
    }
};

interface DatasetNodeProps extends NodeWithStateProps<DatasetNodeState> {
    data: DatasetNodeData;
}

const DatasetNode: FC<DatasetNodeProps> = ({ data, isConnectable, selected }) => {
    const { state, onChangeState, onDeleteNode, isValidConnection } = data;

    const [isCollapsed, setIsCollapsed] = useState(true);
    const [collapsibleHandlesHeights, setCollapsibleHandlesHeights] = useState([] as number[]);

    const [googleSheetsRefetchingIntervalId, setGoogleSheetsRefetchingIntervalId] = useState(undefined as undefined | number);

    useEffect(() => {
        if (state && state.columnHeaders && state.columns && state.columnHeaders.length > 0 && state.columns.length > 0) {
            onChangeState({
                isLoading: false,
            });
        }
    }, [state?.columnHeaders, state?.columns]);

    useEffect(() => {
        if (data.state?.forceRefreshGoogleSheets === false) {
            return;
        }

        if (data.state?.type === 'google-sheets' && state?.googleSheetsUri) {
            const sheetId = state.googleSheetsUri.match(/docs.google.com\/spreadsheets\/d\/(.*)\//)?.[1];

            if (!sheetId) {
                onChangeState({
                    isLoading: true,
                    columns: [],
                    columnHeaders: [],
                });
                return;
            }

            const readColumnsFromGoogleSheets = async (sheetId: string) => {
                const fileId = sheetId;

                const loader = new CSV<string>({
                    includesHeader: true,
                    delimiter: ',',
                });

                // TODO: Add support for specifying API key
                loader.addDataSource(fileId, {
                    sheetId,
                    apiKey: import.meta.env.VITE_GOOGLE_SHEETS_API_KEY,
                } as SheetInput);
                const columnHeaders = await loader.open(fileId);

                onChangeState({ columnHeaders });

                const [columns, loaderDispatch] = loader.load({
                    columns: columnHeaders.map(({ type }) => type.valueOf() as DataType),
                    generatedColumns: [],
                });

                for await (const value of loaderDispatch()) {
                    if (value.type === 'done') {
                        onChangeState({ columns });
                        setupGoogleSheetsRefetchingInterval();
                    }
                }
            };

            readColumnsFromGoogleSheets(sheetId);
            onChangeState({
                forceRefreshGoogleSheets: false,
            });
        }
    }, [state?.googleSheetsUri, state?.forceRefreshGoogleSheets]);

    const setupGoogleSheetsRefetchingInterval = () => {
        clearGoogleSheetsRefetchingInteval();
        const intervalId = window.setInterval(() => {
            onChangeState({
                forceRefreshGoogleSheets: true,
            });
        }, 5000);
        setGoogleSheetsRefetchingIntervalId(intervalId);
    };

    const clearGoogleSheetsRefetchingInteval = () => {
        if (googleSheetsRefetchingIntervalId) {
            clearInterval(googleSheetsRefetchingIntervalId);
            setGoogleSheetsRefetchingIntervalId(undefined);
        }
    };

    useEffect(() => {
        return () => {
            clearGoogleSheetsRefetchingInteval();
        };
    }, []);

    useEffect(() => {
        const readColumnsFromCSVFileOrUri = async (fileOrUri: File | string) => {
            if (USE_CSV_PARSER_INSTEAD_OF_PAPAPARSE) {
                const fileId = fileOrUri instanceof File ? fileOrUri.name : fileOrUri;

                const loader = new CSV<string>({
                    includesHeader: state?.includesHeader || true,
                    delimiter: state?.delimiter || undefined,
                });

                loader.addDataSource(fileId, fileOrUri);
                const columnHeaders = await loader.open(fileId);

                onChangeState({ columnHeaders });

                const [columns, loaderDispatch] = loader.load({
                    columns: columnHeaders.map(({ type }) => type.valueOf() as DataType),
                    generatedColumns: [],
                });

                for await (const value of loaderDispatch()) {
                    if (value.type === 'done') {
                        onChangeState({ columns });
                    }
                }
            } else {
                Papa.parse(fileOrUri, {
                    download: true,
                    header: true,
                    dynamicTyping: true,
                    delimiter: state?.delimiter || ',',
                    skipEmptyLines: true,
                    complete: (data) => {
                        // https://stackoverflow.com/a/9436948
                        const valueIsString = (variable: any): boolean => {
                            return typeof variable === 'string' || variable instanceof String;
                        };

                        const valueIsBoolean = (variable: any): boolean => {
                            return typeof variable === 'boolean';
                        };

                        const columnHeaders = Object.entries(data.data[0] as any).map(([key, value]) => {
                            if (valueIsString(value)) {
                                return {
                                    name: key,
                                    type: DataType.String,
                                } as CSVColumnHeader;
                            } else if (valueIsBoolean(value)) {
                                return {
                                    name: key,
                                    type: DataType.Number,
                                } as CSVColumnHeader;
                            }
                            return {
                                name: key,
                                type: DataType.Number,
                            } as CSVColumnHeader;
                        });

                        onChangeState({ columnHeaders });

                        const columns = columnHeaders.map((columnHeader, index) => {
                            const values = data.data.map((row: any) => {
                                return Object.values(row)[index];
                            });
                            switch (columnHeader.type.valueOf()) {
                                case 'string': {
                                    const column = new StringColumn(columnHeader.name);
                                    const chunk = new StringChunk(values.length, 0);
                                    for (let i = 0; i < values.length; i++) {
                                        chunk.set(i, values[i] as string);
                                    }
                                    column.push(chunk);
                                    return column;
                                }
                                case 'number':
                                default: {
                                    const column = new Float32Column(columnHeader.name);
                                    const chunk = new Float32Chunk(values.length, 0);
                                    for (let i = 0; i < values.length; i++) {
                                        chunk.set(i, values[i] as number);
                                    }
                                    column.push(chunk);
                                    return column;
                                }
                            }
                        }) as CSVColumn[];

                        onChangeState({ columns });
                    },
                });
            }
        };

        if (data.file) {
            readColumnsFromCSVFileOrUri(data.file);
            return;
        }

        if (!data.file && state?.type === 'csv' && state.remoteUri) {
            readColumnsFromCSVFileOrUri(state.remoteUri);
            return;
        }
    }, [data.file, state?.delimiter, state?.type, state?.remoteUri]);

    const { isLoading, columnHeaders, columns } = { ...defaultState, ...data.state };

    const previousElementsHeights = [] as number[];
    for (let index = 0; index < collapsibleHandlesHeights.length; index++) {
        let sumOfPrevElementsHeight = 0;
        for (let prevIndex = 0; prevIndex < index; prevIndex++) {
            sumOfPrevElementsHeight += collapsibleHandlesHeights[prevIndex];
        }
        previousElementsHeights[index] = sumOfPrevElementsHeight;
    }

    const collapsibleHandles = columnHeaders?.map((columnHeader, index) => {
        const column = columns?.find((column) => column.name === columnHeader.name);

        let distinctValuesInStringColumn = undefined;
        if (column?.type === 'string') {
            distinctValuesInStringColumn = getDistinctValuesInStringColumn(column as StringColumn);
        }

        const minMaxString =
            column?.type === 'number'
                ? `↓ ${(column as NumberColumn)?.min.toLocaleString()} ↑ ${(column as NumberColumn)?.max.toLocaleString()}`
                : column?.type === 'date'
                ? `↓ ${DateTime.fromJSDate((column as DateColumn)?.min).toLocaleString()} ↑ ${DateTime.fromJSDate(
                      (column as DateColumn)?.max,
                  ).toLocaleString()}`
                : column?.type === 'string'
                ? `${distinctValuesInStringColumn!.length} Unique`
                : undefined;

        return (
            <CollapsibleHandle
                key={columnHeader.name || index}
                handleElement={
                    <Handle
                        type="source"
                        position={Position.Right}
                        id={columnHeader.name}
                        className="source-handle"
                        isConnectable={isConnectable}
                        isValidConnection={isValidConnection}
                    ></Handle>
                }
                onElementHeightChange={(height) => {
                    collapsibleHandlesHeights[index] = height;
                    setCollapsibleHandlesHeights(collapsibleHandlesHeights);
                }}
                previousElementsHeight={previousElementsHeights[index]}
                isCollapsed={isCollapsed}
            >
                <span className="source-handle-label" title={columnHeader.name}>
                    {columnHeader.name}
                    <br />
                    <small>
                        <strong>{column && column.length}</strong> {prettyPrintDataType(columnHeader.type)}{' '}
                        {column?.type === 'string' ? (
                            <>
                                {'• '}
                                <span className="has-additional-info" title={'[' + distinctValuesInStringColumn!.join(', ') + ']'}>
                                    {minMaxString}
                                </span>
                            </>
                        ) : (
                            minMaxString
                        )}
                    </small>
                </span>
            </CollapsibleHandle>
        );
    });

    return (
        <div
            style={nodeStyleOverrides}
            className={`react-flow__node-default ${selected && 'selected'} ${isLoading && 'pending'} node category-input`}
        >
            <div className="title-wrapper">
                <div className="title hyphenate">
                    {makeTypeHumanReadable(data.state?.type) ? makeTypeHumanReadable(data.state?.type) + ' ' : ''}Dataset
                    {isLoading ? ' …' : ''}
                </div>
                <div className="title-actions">
                    <span>
                        <a
                            onPointerUp={() => {
                                clearGoogleSheetsRefetchingInteval();
                                onDeleteNode();
                            }}
                        >
                            ✕
                        </a>
                    </span>
                </div>
            </div>
            <span
                className="hyphenate"
                dangerouslySetInnerHTML={{ __html: data.filename.replaceAll(/[_. -]/g, (match) => `${match}&shy;`) }}
            />

            {data.state?.type === undefined && !data.file && (
                <div className="nodrag">
                    <table style={{ textAlign: 'right', width: 'calc(100% + 2px)', borderSpacing: '2px' }}>
                        <tbody>
                            <tr>
                                <td>
                                    <label htmlFor="type">Type:</label>
                                </td>
                                <td>
                                    <select
                                        id="type"
                                        value={data.state?.type || 'none'}
                                        onChange={(event) => {
                                            onChangeState({
                                                type: event.target.value as DatasetNodeValidTypes,
                                            });
                                        }}
                                    >
                                        {(['csv', 'google-sheets', 'json', undefined] as DatasetNodeValidTypes[]).map((presetName) => (
                                            <option
                                                disabled={presetName === undefined}
                                                key={presetName || 'none'}
                                                value={presetName || 'none'}
                                            >
                                                {presetName?.replace('-', ' ') || 'Select type …'}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            {!data.file && (data.state?.type === 'json' || data.state?.type === 'csv') && (
                <div className="nodrag">
                    <table style={{ textAlign: 'right', width: 'calc(100% + 2px)', borderSpacing: '2px' }}>
                        <tbody>
                            <tr>
                                <td>
                                    <label htmlFor="url">URL:</label>
                                </td>
                                <td>
                                    <input
                                        id="url"
                                        type="url"
                                        value={data.state?.remoteUri}
                                        onChange={(event) => {
                                            onChangeState({
                                                remoteUri: event.target.value,
                                            });
                                        }}
                                    ></input>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            {data.state?.type === 'google-sheets' && (
                <>
                    <div className="nodrag">
                        <table style={{ textAlign: 'right', width: 'calc(100% + 2px)', borderSpacing: '2px' }}>
                            <tbody>
                                <tr>
                                    <td style={{ width: '48%' }}>
                                        <label htmlFor="google-sheets-uri">Google Sheets URL:</label>
                                    </td>
                                    <td>
                                        <input
                                            type="text"
                                            id="google-sheets-uri"
                                            defaultValue={state?.googleSheetsUri}
                                            onChange={(event) => {
                                                onChangeState({
                                                    googleSheetsUri: event.target.value,
                                                });
                                            }}
                                        />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {data.state?.type !== 'google-sheets' && (
                <>
                    <hr className="divider" />
                    <div className="nodrag">
                        <table style={{ textAlign: 'right', width: 'calc(100% + 2px)', borderSpacing: '2px' }}>
                            <tbody>
                                <tr>
                                    <td>
                                        <label htmlFor="delimiter">Delimiter:</label>
                                    </td>
                                    <td>
                                        <input
                                            id="delimiter"
                                            type="text"
                                            defaultValue={state?.delimiter}
                                            onChange={(event) => {
                                                const updatedDelimiter = event.target.value;
                                                onChangeState({ delimiter: updatedDelimiter });
                                            }}
                                        ></input>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <label htmlFor="includes-header">Includes Header:</label>
                                    </td>
                                    <td>
                                        <select
                                            id="includes-header"
                                            value={
                                                data.state?.includesHeader !== undefined && data.state?.includesHeader === false
                                                    ? 'no'
                                                    : 'yes'
                                            }
                                            onChange={(event) => {
                                                onChangeState({
                                                    includesHeader: event.target.value === 'yes' ? true : false,
                                                });
                                            }}
                                        >
                                            {['yes', 'no'].map((option) => (
                                                <option key={option} value={option}>
                                                    {option}
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            <hr className="divider" />

            <div className="handle-wrapper">
                <Handle
                    type="source"
                    position={Position.Right}
                    id="dataset"
                    className="source-handle handle-dataset"
                    isConnectable={isConnectable}
                    isValidConnection={isValidConnection}
                />
                <span className="source-handle-label">
                    <a
                        className={`nodrag link ${!columnHeaders || columnHeaders.length === 0 ? 'disabled' : ''}`}
                        aria-disabled={!columnHeaders || columnHeaders.length === 0}
                        onClick={() => {
                            setIsCollapsed(!isCollapsed);
                        }}
                    >
                        <strong>
                            {columns && columns[0] ? `${columns[0].length} Rows | ` : ''}
                            {columnHeaders?.length}&nbsp;Columns
                        </strong>{' '}
                        {isCollapsed ? '↓' : '↑'}
                    </a>
                </span>
            </div>
            <Collapse isOpened={!isCollapsed}>{collapsibleHandles}</Collapse>
        </div>
    );
};

export default memo(DatasetNode);
