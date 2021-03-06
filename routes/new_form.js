var express = require('express');
var ObjectID = require('mongodb').ObjectID;
var router = express.Router();

var multer  = require('multer');
var upload = multer({dest: 'public/photos/'});

var forms = DB.collection('forms');

/* Admin page for creating new forms */
router.all('/', upload.any(), function(req, res, next) {
    // req.files contains all the pictures that were uploaded thanks to multer middleware
    if (!req.session.admin) {
        res.redirect('admin');
        return;
    }
    if (!validateParams(req, ['form-name', 'timezone-offset', 'close-datetime'])) {
        res.render('new_form');
        return;
    }
    /* Time to build the database entry */
    var form = {name: req.body['form-name'], items: [], live: false,
        team_id: ObjectID(req.session.team_id)};
    if (hasParam(req, 'form-id')) { // updating existing form
        form._id = new ObjectID(req.body['form-id']);
    }

    forms.findOne({_id: form._id}, function(err, the_form) {
        var id_to_item = {};
        if (the_form) {
            for (var item of the_form.items) {
                id_to_item[item.item_id] = item;
            }
        }
        var item_num_to_id = {};
        var current_item_num = -1;
        var auto_gen_subitems = [];
        for (var key in req.body) {
            if (key.indexOf('item-num') === 0) { // It's a new item
                if (auto_gen_subitems.length !== 0) { // save to previous item
                    addAutoGenToItems(form.items[current_item_num], auto_gen_subitems);
                    auto_gen_subitems = [];
                }
                var item_id = '';
                var photo_path = '';
                if (hasParam(req, 'id-' + key)) { // updating existing item
                    item_id = new ObjectID(req.body['id-' + key]);
                    photo_path = id_to_item[item_id].photo_path;
                } else { // It's a new item
                    item_id = new ObjectID(); // orders are linked to this id
                }
                form.items.push({
                    name: req.body[key], sizes: [], subitems: [],
                    'item_id': item_id, 'photo_path': photo_path, supports_nums: false
                });
                item_num_to_id[current_item_num] = item_id;
                current_item_num++;
            } else if (key.indexOf('subitem-num') === 0) { // new subitem
                var subitem_id = '';
                if (hasParam(req, 'id-' + key)) { // updating existing subitem
                    subitem_id = new ObjectID(req.body['id-' + key]);
                } else { // it's a new subitem
                    subitem_id = new ObjectID();
                }
                form.items[current_item_num].subitems.push(
                    {name: req.body[key], sizes:[], 'subitem_id': subitem_id}
                );
            } else if (key.indexOf('item-size') === 0) {
                form.items[current_item_num].sizes = [].concat(req.body[key]);
            } else if (key.indexOf('subitem-size') === 0) {
                form.items[current_item_num].subitems[form.items[current_item_num].
                    subitems.length - 1].sizes = [].concat(req.body[key]);
            } else if (key.indexOf('supports-nums') === 0) {
                form.items[current_item_num].supports_nums = true;
            } else if (key.indexOf('number-options') === 0) {
                if (hasParam(req, 'id-' + key)) { // updating existing item
                    // this case should never happen
                    console.error('number-options should not be submitted with existing item');
                } else { // new item
                    var item_name = form.items[current_item_num].name;
                    for (var number_option of req.body[key]) {
                        var subitem_name = '';
                        switch(number_option) {
                            case 'fb':
                                subitem_name = 'with front and back numbers';
                                break;
                            case 'f':
                                subitem_name = 'with front number';
                                break;
                            case 'b':
                                subitem_name = 'with back number';
                                break;
                            case 'n':
                                subitem_name = 'with no numbers';
                                break;
                        }
                        auto_gen_subitems.push(
                            {name: subitem_name, sizes: [], 'subitem_id': new ObjectID()}
                        );
                    }
                }
            } else if (key.indexOf('close-datetime') === 0) { // The closing datetime
                var server_offset = new Date().getTimezoneOffset();
                var client_offset = req.body['timezone-offset'];
                var orig_time = new Date(req.body[key]);
                orig_time = new Date(orig_time.getTime() + client_offset * 60 * 1000);
                form.date = new Date(orig_time.getTime() +
                    ((client_offset - server_offset) * 60 * 1000));
                form.client_date_offset = client_offset;
            } else if (key.indexOf('form-live') === 0) { // is the form live?
                form.live = true;
            }
        }
        // handle any dangling auto generated items
        if (auto_gen_subitems.length !== 0) { // save to previous item
            addAutoGenToItems(form.items[current_item_num], auto_gen_subitems);
        }
        for (var file of req.files) { // these are the picture uploads
            var item_num = parseInt(file.fieldname.substring(file.fieldname.indexOf('-') + 1));
            var item_id = item_num_to_id[item_num];
            form.items[item_num].photo_path = 'photos/' + file.filename ;
        }
        forms.save(form);
        res.redirect('admin');
    });
});

module.exports = router;

function hasParam(req, param) {
    return (req.body[param] !== undefined && req.body[param] !== '');
}

function validateParams(req, paramsList) {
    if (!req.body || req.body === null || req.body == {})
        return false;
    for (var param of paramsList) {
        var current = req.body[param];
        if (current === undefined || current === '')
            return false;
    }
    return true;
}

function addAutoGenToItems(item, auto_gen_subitems) {
    if (item.subitems.length == 0) {
        for (var auto_gen of auto_gen_subitems) {
            auto_gen.sizes = item.sizes;
            item.subitems.push(auto_gen);
        }
        item.sizes = [];
    } else {
        var to_save = [];
        for (var subitem of item.subitems) {
            for (var auto_gen of auto_gen_subitems) {
                var auto_gen_clone = deepClone(auto_gen);
                auto_gen_clone.sizes = subitem.sizes;
                auto_gen_clone.subitem_id = new ObjectID();
                to_save.push(auto_gen_clone);
                to_save[to_save.length - 1].name = subitem.name + ' ' + to_save[to_save.length - 1].name;
            }
        }
        item.subitems = [];
        for (var auto_gen of to_save) {
            item.subitems.push(auto_gen);
        }
    }
}

function deepClone(a) {
    return JSON.parse(JSON.stringify(a));
}
