import { Component, OnInit, ElementRef, ViewChild } from '@angular/core';
import { Risque } from './risque/risque';

@Component({
  selector: 'app-editor',
  templateUrl: './editor.component.html',
  styleUrls: ['./editor.component.css']
})
export class EditorComponent implements OnInit {

  @ViewChild('divEditor') div: ElementRef;
  risque: Risque;

  ngOnInit() {

    this.risque = new Risque(this.div.nativeElement, {
      blockTag: 'p',
      blockAttributes: { 'class': 'paragraph' },
      tagAttributes: {
        ul: { 'class': 'UL' },
        ol: { 'class': 'OL' },
        li: { 'class': 'listItem' },
        a: { 'target': '_blank' }
      }
    });
    this.risque.setHTML('Petite encyclopédie populaire de la vie pratique');
  }

  setSize(value) {
    this.risque.setFontSize(parseInt(value, 10));
  }
  toggleBold() {
    this.risque.toggleFormat('B', (/>B\b/));
  }
  toggleItalic() {
    this.risque.toggleFormat('I', (/>I\b/));
  }

  exec(comm: string) {
    this.risque[comm]();
  }

}
