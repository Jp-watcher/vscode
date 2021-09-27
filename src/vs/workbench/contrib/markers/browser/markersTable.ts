/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import * as network from 'vs/base/common/network';
import { Event } from 'vs/base/common/event';
import { ITableContextMenuEvent, ITableEvent, ITableRenderer, ITableVirtualDelegate } from 'vs/base/browser/ui/table/table';
import { Disposable } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IOpenEvent, WorkbenchTable } from 'vs/platform/list/browser/listService';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { Marker, ResourceMarkers } from 'vs/workbench/contrib/markers/browser/markersModel';
import { MarkerSeverity } from 'vs/platform/markers/common/markers';
import { SeverityIcon } from 'vs/platform/severityIcon/common/severityIcon';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { ILabelService } from 'vs/platform/label/common/label';
import { FilterOptions } from 'vs/workbench/contrib/markers/browser/markersFilterOptions';
import { IMatch } from 'vs/base/common/filters';
import { Link } from 'vs/platform/opener/browser/link';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { MarkersViewModel } from 'vs/workbench/contrib/markers/browser/markersTreeViewer';
import { IAction } from 'vs/base/common/actions';
import { QuickFixAction, QuickFixActionViewItem } from 'vs/workbench/contrib/markers/browser/markersViewActions';
import { DomEmitter } from 'vs/base/browser/event';
import Messages from 'vs/workbench/contrib/markers/browser/messages';
import { isUndefinedOrNull } from 'vs/base/common/types';
import { IProblemsWidget } from 'vs/workbench/contrib/markers/browser/markersView';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

const $ = DOM.$;

export class MarkerTableItem extends Marker {
	constructor(
		marker: Marker,
		readonly sourceMatches?: IMatch[],
		readonly codeMatches?: IMatch[],
		readonly messageMatches?: IMatch[],
		readonly fileMatches?: IMatch[],
		readonly ownerMatches?: IMatch[],
	) {
		super(marker.id, marker.marker, marker.relatedInformation);
	}
}

interface IMarkerIconColumnTemplateData {
	readonly icon: HTMLElement;
	readonly actionBar: ActionBar;
}

interface IMarkerMessageColumnTemplateData {
	readonly messageColumn: HTMLElement;
	readonly messageLabel: HighlightedLabel;
	readonly sourceLabel: HighlightedLabel;
	readonly codeLabel: HighlightedLabel;
	readonly codeLink: Link;
}

interface IMarkerFileColumnTemplateData {
	readonly fileLabel: HighlightedLabel;
	readonly positionLabel: HighlightedLabel;
}


interface IMarkerHighlightedLabelColumnTemplateData {
	readonly highlightedLabel: HighlightedLabel;
}

class MarkerSeverityColumnRenderer implements ITableRenderer<MarkerTableItem, IMarkerIconColumnTemplateData>{

	static readonly TEMPLATE_ID = 'severity';

	readonly templateId: string = MarkerSeverityColumnRenderer.TEMPLATE_ID;

	constructor(
		private readonly markersViewModel: MarkersViewModel,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) { }

	renderTemplate(container: HTMLElement): IMarkerIconColumnTemplateData {
		const severityColumn = DOM.append(container, $('.severity'));
		const icon = DOM.append(severityColumn, $(''));

		const actionBarColumn = DOM.append(container, $('.actions'));
		const actionBar = new ActionBar(actionBarColumn, {
			actionViewItemProvider: (action: IAction) => action.id === QuickFixAction.ID ? this.instantiationService.createInstance(QuickFixActionViewItem, <QuickFixAction>action) : undefined,
			animated: false
		});

		return { actionBar, icon };
	}

	renderElement(element: MarkerTableItem, index: number, templateData: IMarkerIconColumnTemplateData, height: number | undefined): void {
		const toggleQuickFix = (enabled?: boolean) => {
			if (!isUndefinedOrNull(enabled)) {
				const container = DOM.findParentWithClass(templateData.icon, 'monaco-table-td')!;
				container.classList.toggle('quickFix', enabled);
			}
		};

		templateData.icon.className = `marker-icon codicon ${SeverityIcon.className(MarkerSeverity.toSeverity(element.marker.severity))}`;

		templateData.actionBar.clear();
		const viewModel = this.markersViewModel.getViewModel(element);
		if (viewModel) {
			const quickFixAction = viewModel.quickFixAction;
			templateData.actionBar.push([quickFixAction], { icon: true, label: false });
			toggleQuickFix(viewModel.quickFixAction.enabled);

			quickFixAction.onDidChange(({ enabled }) => toggleQuickFix(enabled));
		}
	}

	disposeTemplate(templateData: IMarkerIconColumnTemplateData): void { }
}

class MarkerMessageColumnRenderer implements ITableRenderer<MarkerTableItem, IMarkerMessageColumnTemplateData>{

	static readonly TEMPLATE_ID = 'message';

	readonly templateId: string = MarkerMessageColumnRenderer.TEMPLATE_ID;

	constructor(
		@IOpenerService private readonly openerService: IOpenerService
	) { }

	renderTemplate(container: HTMLElement): IMarkerMessageColumnTemplateData {
		const messageColumn = DOM.append(container, $('.message'));

		const messageLabel = new HighlightedLabel(messageColumn, false);

		const sourceLabel = new HighlightedLabel(messageColumn, false);
		sourceLabel.element.classList.add('source-label');

		const codeLabel = new HighlightedLabel(messageColumn, false);
		codeLabel.element.classList.add('code-label');

		const codeLink = new Link(messageColumn, { href: '', label: '' }, {}, this.openerService);

		return { messageColumn, messageLabel, sourceLabel, codeLabel, codeLink };
	}

	renderElement(element: MarkerTableItem, index: number, templateData: IMarkerMessageColumnTemplateData, height: number | undefined): void {
		templateData.messageLabel.set(element.marker.message, element.messageMatches);

		if (element.marker.source && element.marker.code) {
			templateData.messageColumn.classList.toggle('code-link', typeof element.marker.code !== 'string');

			if (typeof element.marker.code === 'string') {
				templateData.sourceLabel.set(element.marker.source, element.sourceMatches);
				templateData.codeLabel.set(element.marker.code, element.codeMatches);
			} else {
				templateData.sourceLabel.set(element.marker.source, element.sourceMatches);

				const codeLinkLabel = new HighlightedLabel($('.code-link-label'), false);
				codeLinkLabel.set(element.marker.code.value, element.codeMatches);

				templateData.codeLink.link = {
					href: element.marker.code.target.toString(),
					title: element.marker.code.target.toString(),
					label: codeLinkLabel.element,
				};
			}
		}
	}

	disposeTemplate(templateData: IMarkerMessageColumnTemplateData): void { }
}

class MarkerFileColumnRenderer implements ITableRenderer<MarkerTableItem, IMarkerFileColumnTemplateData>{

	static readonly TEMPLATE_ID = 'file';

	readonly templateId: string = MarkerFileColumnRenderer.TEMPLATE_ID;

	constructor(
		@ILabelService private readonly labelService: ILabelService
	) { }

	renderTemplate(container: HTMLElement): IMarkerFileColumnTemplateData {
		const fileColumn = DOM.append(container, $('.file'));
		const fileLabel = new HighlightedLabel(fileColumn, false);
		fileLabel.element.classList.add('file-label');
		const positionLabel = new HighlightedLabel(fileColumn, false);
		positionLabel.element.classList.add('file-position');

		return { fileLabel, positionLabel };
	}

	renderElement(element: MarkerTableItem, index: number, templateData: IMarkerFileColumnTemplateData, height: number | undefined): void {
		templateData.fileLabel.set(this.labelService.getUriLabel(element.marker.resource, { relative: true }), element.fileMatches);
		templateData.positionLabel.set(Messages.MARKERS_PANEL_AT_LINE_COL_NUMBER(element.marker.startLineNumber, element.marker.startColumn), undefined);
	}

	disposeTemplate(templateData: IMarkerFileColumnTemplateData): void { }
}

class MarkerOwnerColumnRenderer implements ITableRenderer<MarkerTableItem, IMarkerHighlightedLabelColumnTemplateData>{

	static readonly TEMPLATE_ID = 'owner';

	readonly templateId: string = MarkerOwnerColumnRenderer.TEMPLATE_ID;

	renderTemplate(container: HTMLElement): IMarkerHighlightedLabelColumnTemplateData {
		const fileColumn = DOM.append(container, $('.owner'));
		const highlightedLabel = new HighlightedLabel(fileColumn, false);
		return { highlightedLabel };
	}

	renderElement(element: MarkerTableItem, index: number, templateData: IMarkerHighlightedLabelColumnTemplateData, height: number | undefined): void {
		templateData.highlightedLabel.set(element.marker.owner, element.ownerMatches);
	}

	disposeTemplate(templateData: IMarkerHighlightedLabelColumnTemplateData): void { }
}

class MarkersTableVirtualDelegate implements ITableVirtualDelegate<any> {
	static readonly HEADER_ROW_HEIGHT = 24;
	static readonly ROW_HEIGHT = 24;
	readonly headerRowHeight = MarkersTableVirtualDelegate.HEADER_ROW_HEIGHT;

	getHeight(item: any) {
		return MarkersTableVirtualDelegate.ROW_HEIGHT;
	}
}

export class MarkersTable extends Disposable implements IProblemsWidget {

	private _itemCount: number = 0;
	private readonly table: WorkbenchTable<MarkerTableItem>;

	constructor(
		private readonly container: HTMLElement,
		private readonly markersViewModel: MarkersViewModel,
		private resourceMarkers: ResourceMarkers[],
		private filterOptions: FilterOptions,
		@IContextKeyService readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILabelService private readonly labelService: ILabelService,
	) {
		super();

		this.table = this.instantiationService.createInstance(WorkbenchTable,
			'Markers',
			this.container,
			new MarkersTableVirtualDelegate(),
			[
				{
					label: '',
					tooltip: '',
					weight: 0,
					minimumWidth: 36,
					maximumWidth: 36,
					templateId: MarkerSeverityColumnRenderer.TEMPLATE_ID,
					project(row: Marker): Marker { return row; }
				},
				{
					label: localize('messageColumnLabel', "Message"),
					tooltip: '',
					weight: 2,
					templateId: MarkerMessageColumnRenderer.TEMPLATE_ID,
					project(row: Marker): Marker { return row; }
				},
				{
					label: localize('fileColumnLabel', "File"),
					tooltip: '',
					weight: 1,
					templateId: MarkerFileColumnRenderer.TEMPLATE_ID,
					project(row: Marker): Marker { return row; }
				},
				{
					label: localize('sourceColumnLabel', "Source"),
					tooltip: '',
					weight: 1,
					templateId: MarkerOwnerColumnRenderer.TEMPLATE_ID,
					project(row: Marker): Marker { return row; }
				}
			],
			[
				this.instantiationService.createInstance(MarkerSeverityColumnRenderer, this.markersViewModel),
				this.instantiationService.createInstance(MarkerMessageColumnRenderer),
				this.instantiationService.createInstance(MarkerFileColumnRenderer),
				this.instantiationService.createInstance(MarkerOwnerColumnRenderer),
			],
			{
				horizontalScrolling: false,
				multipleSelectionSupport: false
			}
		) as WorkbenchTable<MarkerTableItem>;

		const list = this.table.domNode.querySelector('.monaco-list-rows')! as HTMLElement;

		// TODO - clean this up
		const onMouseOver = new DomEmitter(list, 'mouseover');
		const onRowHover = Event.chain(onMouseOver.event)
			.map(e => DOM.findParentWithClass(e.target as HTMLElement, 'monaco-list-row', 'monaco-list-rows'))
			.filter<HTMLElement>(((e: HTMLElement | null) => !!e) as any)
			.map(e => parseInt(e.getAttribute('data-index')!))
			.event;

		const onMouseLeave = new DomEmitter(list, 'mouseleave');
		const onListLeave = Event.map(onMouseLeave.event, () => -1);

		const onRowHoverOrLeave = Event.latch(Event.any(onRowHover, onListLeave));
		const onRowPermanentHover = Event.debounce(onRowHoverOrLeave, (_, e) => e, 500);

		onRowPermanentHover(e => {
			if (e !== -1) {
				this.markersViewModel.onMarkerMouseHover(this.table.row(e));
			}
		});
	}

	get onContextMenu(): Event<ITableContextMenuEvent<MarkerTableItem>> {
		return this.table.onContextMenu;
	}

	get onDidOpen(): Event<IOpenEvent<MarkerTableItem | undefined>> {
		return this.table.onDidOpen;
	}

	get onDidChangeFocus(): Event<ITableEvent<MarkerTableItem>> {
		return this.table.onDidChangeFocus;
	}

	get onDidChangeSelection(): Event<ITableEvent<MarkerTableItem>> {
		return this.table.onDidChangeSelection;
	}

	collapseMarkers(): void { }

	domFocus(): void {
		this.table.domFocus();
	}

	filterMarkers(resourceMarkers: ResourceMarkers[], filterOptions: FilterOptions): void {
		this.filterOptions = filterOptions;
		this.reset(resourceMarkers);
	}

	getFocus(): (Marker | null)[] {
		return [];
	}

	getHTMLElement(): HTMLElement {
		return this.table.getHTMLElement();
	}

	getRelativeTop(location: Marker | null): number | null {
		return null;
	}

	getSelection(): any {
		return this.table.getSelection();
	}

	getVisibleItemCount(): number {
		return this._itemCount;
	}

	isVisible(): boolean {
		return !this.container.classList.contains('hidden');
	}

	layout(height: number, width: number): void {
		this.table.layout(height, width);
	}

	reset(resourceMarkers: ResourceMarkers[]): void {
		this.resourceMarkers = resourceMarkers;

		const items: MarkerTableItem[] = [];
		for (const resourceMarker of this.resourceMarkers) {
			for (const marker of resourceMarker.markers) {
				if (marker.resource.scheme === network.Schemas.walkThrough || marker.resource.scheme === network.Schemas.walkThroughSnippet) {
					continue;
				}

				// Exclude pattern
				if (this.filterOptions.excludesMatcher.matches(marker.resource)) {
					continue;
				}

				// Include pattern
				if (this.filterOptions.includesMatcher.matches(marker.resource)) {
					items.push(new MarkerTableItem(marker));
					continue;
				}

				// Severity filter
				const matchesSeverity = this.filterOptions.showErrors && MarkerSeverity.Error === marker.marker.severity ||
					this.filterOptions.showWarnings && MarkerSeverity.Warning === marker.marker.severity ||
					this.filterOptions.showInfos && MarkerSeverity.Info === marker.marker.severity;

				if (!matchesSeverity) {
					continue;
				}

				// Text filter
				if (this.filterOptions.textFilter.text) {
					const sourceMatches = marker.marker.source ? FilterOptions._filter(this.filterOptions.textFilter.text, marker.marker.source) ?? undefined : undefined;
					const codeMatches = marker.marker.code ? FilterOptions._filter(this.filterOptions.textFilter.text, typeof marker.marker.code === 'string' ? marker.marker.code : marker.marker.code.value) ?? undefined : undefined;
					const messageMatches = FilterOptions._messageFilter(this.filterOptions.textFilter.text, marker.marker.message) ?? undefined;
					const fileMatches = FilterOptions._messageFilter(this.filterOptions.textFilter.text, this.labelService.getUriLabel(marker.resource, { relative: true })) ?? undefined;
					const ownerMatches = FilterOptions._messageFilter(this.filterOptions.textFilter.text, marker.marker.owner) ?? undefined;

					const matched = sourceMatches || codeMatches || messageMatches || fileMatches || ownerMatches;
					if ((matched && !this.filterOptions.textFilter.negate) || (!matched && this.filterOptions.textFilter.negate)) {
						items.push(new MarkerTableItem(marker, sourceMatches, codeMatches, messageMatches, fileMatches, ownerMatches));
					}

					continue;
				}

				items.push(new MarkerTableItem(marker));
			}
		}
		this._itemCount = items.length;
		this.table.splice(0, Number.POSITIVE_INFINITY, items.sort((a, b) => MarkerSeverity.compare(a.marker.severity, b.marker.severity)));
	}

	revealMarkers(activeResource: ResourceMarkers | null, focus: boolean): void { }

	setAriaLabel(label: string): void {
		this.table.domNode.ariaLabel = label;
	}

	setMarkerSelection(): void {
	}

	toggleVisibility(hide: boolean): void {
		this.container.classList.toggle('hidden', hide);
	}

	update(resourceMarkers: ResourceMarkers[]): void {
		for (const resourceMarker of resourceMarkers) {
			const index = this.resourceMarkers.indexOf(resourceMarker);
			this.resourceMarkers.splice(index, 1, resourceMarker);
		}
		this.reset(this.resourceMarkers);
	}

	updateMarker(marker: Marker): void {
	}
}