import React, { useEffect } from 'react';
import { ReactFlowProvider, XYPosition } from 'react-flow-renderer/nocss';

import Split from 'react-split';

import BasicFlow from './data/BasicFlow';
import { lab2rgb } from './data/nodes/util/colorTransformations';
import { Cuboid, DatacanvasRenderer, mapLABColorRangeToNonZeroOne } from './visualization/DatacanvasApplication';
import { DatacubeInformation, DatacanvasVisualization } from './visualization/DatacanvasVisualization';

const Controls: React.FC<{
    onChangeHighQualityRenderingImageBase64: (base64String: string | undefined) => void;
    showClearButton?: boolean;
}> = ({ showClearButton, onChangeHighQualityRenderingImageBase64 }) => {
    const [fetchAbortController, setFetchAbortController] = React.useState(undefined as undefined | AbortController);
    const [isPerspectiveCamera, setIsPerspectiveCamera] = React.useState(true);

    useEffect(() => {
        if ((window['renderer'] as DatacanvasRenderer) !== undefined) {
            (window['renderer'] as DatacanvasRenderer).isPerspectiveCamera = isPerspectiveCamera;
        }
    }, [isPerspectiveCamera]);

    const onRenderHighQualityVisualization = async () => {
        let usedAbortController;

        if (fetchAbortController) {
            (fetchAbortController as AbortController).abort();
            usedAbortController = fetchAbortController;
        } else {
            usedAbortController = new AbortController();
            setFetchAbortController(usedAbortController);
        }

        const width = (window['renderer'] as any).canvasSize[0];
        const height = (window['renderer'] as any).canvasSize[1];
        const cameraCenter = Object.values((window['renderer'] as any)._camera.center);
        const cameraEye = Object.values((window['renderer'] as any)._camera.eye);
        const cameraFovYDegrees = (window['renderer'] as any)._camera.fovy;
        let sceneElements = (window['renderer'] as any)._cuboids as Array<Partial<Cuboid>>;
        const datacubePositions = (window['renderer'] as any).datacubePositions as Map<number, XYPosition>;
        const datacubes = (window['renderer'] as any).datacubes as DatacubeInformation[];

        // Keep this in sync with headless-renderer-blender.py, but use as few properties as possible (to reduce size of serialized data)
        sceneElements = sceneElements.map((cuboid) => {
            const id = cuboid.id;
            let translateXZ;
            if (id !== undefined) {
                translateXZ = datacubePositions.get(4294967295 - id);
            }
            const colorRGB = cuboid.colorLAB ? lab2rgb(mapLABColorRangeToNonZeroOne(cuboid.colorLAB)) : undefined;
            if (colorRGB) {
                colorRGB[0] /= 255;
                colorRGB[1] /= 255;
                colorRGB[2] /= 255;
            }
            let type = undefined;
            if (id !== undefined) {
                const matchingDatacube = datacubes.find((datacube) => datacube.id === 4294967295 - id);
                type = matchingDatacube?.type;
            }
            return {
                id: cuboid.id,
                colorRGB,
                translateXZ: {
                    '0': translateXZ?.x || 0,
                    '1': translateXZ?.y || 0,
                },
                translateY: cuboid.translateY,
                scaleY: cuboid.scaleY,
                idBufferOnly: cuboid.idBufferOnly,
                extent: cuboid.extent,
                points: cuboid.points,
                type,
            };
        });

        let response;

        try {
            response = await fetch('/api/renderings/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    camera_center: cameraCenter,
                    camera_eye: cameraEye,
                    camera_fov_y_degrees: cameraFovYDegrees,
                    width,
                    height,
                    scene_elements: sceneElements,
                }),
                signal: usedAbortController.signal,
            });
            if (!response.ok) {
                throw new Error(response.statusText);
            }
        } catch (error) {
            onChangeHighQualityRenderingImageBase64(undefined);
            setFetchAbortController(undefined);
            return;
        }

        const blob = await response.blob();

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = function () {
            const base64data = reader.result;
            if (base64data) {
                onChangeHighQualityRenderingImageBase64(base64data.toString());
            }
            setFetchAbortController(undefined);
        };
    };

    return (
        <div
            style={{
                marginTop: '1rem',
                marginLeft: '1rem',
                fontSize: '1.2rem',
                position: 'absolute',
                top: '0',
                pointerEvents: 'initial',
            }}
        >
            <a
                className="link"
                onClick={() => {
                    if (fetchAbortController) {
                        fetchAbortController.abort();
                        setFetchAbortController(undefined);
                        return;
                    }
                    onRenderHighQualityVisualization();
                }}
            >
                {fetchAbortController ? 'Rendering high-quality visualization (click to cancel) …' : 'Render high-quality visualization'}
            </a>
            {showClearButton && (
                <a style={{ marginLeft: '1rem' }} className="link" onClick={() => onChangeHighQualityRenderingImageBase64(undefined)}>
                    Clear
                </a>
            )}
            <a
                className="link"
                style={{ marginLeft: '1rem' }}
                onClick={() => {
                    setIsPerspectiveCamera((prev) => !prev);
                }}
            >
                {isPerspectiveCamera ? 'Switch to Orthographic' : 'Switch to Perspective'}
            </a>
        </div>
    );
};

function App() {
    const highQualityRenderingOverlayRef = React.useRef<HTMLDivElement | null>(null);
    const [highQualityRenderingImageBase64, setHighQualityRenderingImageBase64] = React.useState(undefined as string | undefined);

    useEffect(() => {
        if (highQualityRenderingImageBase64 && highQualityRenderingOverlayRef.current) {
            highQualityRenderingOverlayRef.current.style.backgroundImage = `url(${highQualityRenderingImageBase64})`;
            // Block pointer events to the underlying WebGL canvas
            highQualityRenderingOverlayRef.current.style.pointerEvents = 'all';
            highQualityRenderingOverlayRef.current.style.backgroundSize = 'contain';
            highQualityRenderingOverlayRef.current.style.display = 'block';
            // Remove the image when the user triggers a pointer-down event on the overlay
            highQualityRenderingOverlayRef.current.onpointerdown = () => {
                setHighQualityRenderingImageBase64(undefined);
            };
        } else if (highQualityRenderingOverlayRef.current) {
            highQualityRenderingOverlayRef.current.style.pointerEvents = 'none';
            highQualityRenderingOverlayRef.current.style.display = 'none';
        }
    }, [highQualityRenderingImageBase64]);

    return (
        <ReactFlowProvider>
            <div id="context-menu-destination"></div>
            <Split
                sizes={[50, 50]}
                className="split"
                direction="vertical"
                gutter={(): HTMLElement => {
                    const gutter = document.createElement('div');
                    gutter.className = `gutter gutter-vertical`;
                    return gutter;
                }}
            >
                <BasicFlow />
                <DatacanvasVisualization>
                    <div style={{ width: '100%', height: '100%', pointerEvents: 'none' }} ref={highQualityRenderingOverlayRef}></div>
                    <Controls
                        onChangeHighQualityRenderingImageBase64={(base64String) => setHighQualityRenderingImageBase64(base64String)}
                        showClearButton={highQualityRenderingImageBase64 !== undefined}
                    />
                </DatacanvasVisualization>
            </Split>
        </ReactFlowProvider>
    );
}

export default App;
